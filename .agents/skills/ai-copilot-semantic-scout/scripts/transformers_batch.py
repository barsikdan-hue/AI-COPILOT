"""Optional Transformers Scout adapter; --self-test uses only stdlib."""

import argparse
import copy
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import platform
import re
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


CONTRACT_SHA256 = "9f86d71b239c2d865167764a8351f76e69124113b87739088beed028730aaf2f"
AUTHORITY_SIGNATURE = "e6ad9121f5ee53212954edd2b261b9dcda226ad52d9c8df06e721003fd4a492b"
RUNNER = "transformers-batch-v1"
LABELS = frozenset(("YES", "NO", "UNKNOWN"))
MANIFEST_FIELDS = frozenset((
    "schemaVersion", "runId", "sourceHead", "sourceHashes", "inputSha256", "requestIds",
    "contractSha256", "model", "promptHash", "settingsHash", "policyVersion", "policyHash",
    "projectionHash", "questionRegistryHash", "fingerprintVersion", "fingerprintHash", "runnerIdentity", "selection",
))


class RuntimeUnavailable(Exception):
    """Pre-inference unavailability, represented only by a SKIP marker."""


class InputLimit(Exception):
    """Full input exceeds the frozen token limit; never truncate it."""


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _canonical(value):
    # Scout's metadata canonicalization uses JS integer encoding (1.0 -> 1).
    # settingsHash is historical Python JSON and is checked separately, retaining 1.0.
    def integers(item):
        if isinstance(item, float):
            if not math.isfinite(item) or not item.is_integer() or abs(item) > 2**53 - 1:
                raise ValueError("NON_CANONICAL_NUMBER")
            return int(item)
        if isinstance(item, list):
            return [integers(nested) for nested in item]
        if isinstance(item, dict):
            return {key: integers(nested) for key, nested in item.items()}
        return item
    return _json(integers(value))


def _metadata_hash(value):
    return _sha(_canonical(value).encode("utf-8"))


def _strict_json(data):
    def pairs(entries):
        result = {}
        for key, value in entries:
            if key in result:
                raise ValueError("DUPLICATE_JSON_KEY")
            result[key] = value
        return result
    def invalid_constant(_value):
        raise ValueError("NON_FINITE_JSON_NUMBER")
    try:
        text = data.decode("utf-8", errors="strict")
        if text.startswith("\ufeff"):
            raise ValueError("JSON_BOM")
        return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("INVALID_JSON_ENCODING") from error


def _fields(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def _nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def _hex(value, length=64):
    return isinstance(value, str) and re.fullmatch("[a-f0-9]{" + str(length) + "}", value) is not None


def _count(value):
    return type(value) is int and 0 <= value <= 2**53 - 1


def validate_bundle(manifest: dict, requests_bytes: bytes, contract: dict) -> list[dict]:
    """Stdlib-only validation; accepts frozen authority and opaque wire ids only."""
    if not isinstance(contract, dict) or _metadata_hash(contract) != AUTHORITY_SIGNATURE:
        raise ValueError("CONTRACT_DRIFT")
    if (_sha(contract["systemPrompt"].encode("utf-8")) != contract["promptHash"]
            or _sha(json.dumps(contract["settings"], sort_keys=True, allow_nan=False).encode("utf-8")) != contract["settingsHash"]):
        raise ValueError("PROMPT_SETTINGS_DRIFT")
    if not _fields(manifest, MANIFEST_FIELDS):
        raise ValueError("BATCH_MANIFEST_SCHEMA")
    ids, selection = manifest["requestIds"], manifest["selection"]
    source_hashes = manifest["sourceHashes"]
    if (type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != 1
            or not _nonempty(manifest["runId"]) or not _hex(manifest["sourceHead"], 40)
            or not isinstance(source_hashes, dict) or not source_hashes
            or not all(_nonempty(key) and _hex(value) for key, value in source_hashes.items())
            or not isinstance(ids, list) or not all(_hex(value) for value in ids) or len(set(ids)) != len(ids)
            or not _fields(selection, ("observed", "selected", "rejected"))
            or not all(_count(value) for value in selection.values())
            or selection["selected"] != len(ids) or selection["observed"] != selection["selected"] + selection["rejected"]
            or not all(_hex(manifest[key]) for key in ("inputSha256", "contractSha256", "promptHash", "settingsHash", "policyHash", "projectionHash", "questionRegistryHash", "fingerprintHash"))):
        raise ValueError("BATCH_MANIFEST_SCHEMA")
    for key in ("model", "promptHash", "settingsHash", "policyVersion", "fingerprintVersion"):
        if manifest[key] != contract[key]:
            raise ValueError("PROVENANCE_MISMATCH:" + key)
    if manifest["contractSha256"] != CONTRACT_SHA256 or manifest["runnerIdentity"] != RUNNER:
        raise ValueError("FROZEN_AUTHORITY_MISMATCH")
    metadata = {
        "policyHash": {key: contract[key] for key in ("policy", "questionPolicy", "slicePolicy")},
        "projectionHash": contract["projections"], "questionRegistryHash": contract["questionRegistry"],
        "fingerprintHash": {"version": contract["fingerprintVersion"]},
    }
    if any(manifest[key] != _metadata_hash(value) for key, value in metadata.items()):
        raise ValueError("FROZEN_METADATA_MISMATCH")
    if not isinstance(requests_bytes, bytes) or _sha(requests_bytes) != manifest["inputSha256"]:
        raise ValueError("REQUEST_BYTES_DRIFT")
    if requests_bytes and (not requests_bytes.endswith(b"\n") or b"\r" in requests_bytes or requests_bytes.startswith(b"\xef\xbb\xbf")):
        raise ValueError("MALFORMED_JSONL_ENCODING")
    rows = [] if not requests_bytes else [_strict_json(line) for line in requests_bytes[:-1].split(b"\n")]
    questions = set(contract["questionRegistry"].values())
    for row in rows:
        if (not _fields(row, ("id", "turns", "question")) or not _hex(row["id"])
                or not isinstance(row["question"], str) or row["question"] not in questions
                or not isinstance(row["turns"], list) or not row["turns"]
                or not all(_fields(turn, ("speaker", "text")) and turn["speaker"] in ("agent", "client")
                           and isinstance(turn["text"], str) for turn in row["turns"])):
            raise ValueError("SCOUT_REQUEST_SCHEMA")
    if [row["id"] for row in rows] != ids:
        raise ValueError("REQUEST_IDS_MISMATCH")
    return rows


def format_messages(request: dict, system_prompt: str) -> list[dict]:
    dialogue = "\n".join(("Клиент" if turn["speaker"] == "client" else "Агент") + ": " + turn["text"] for turn in request["turns"])
    return [{"role": "system", "content": system_prompt},
            {"role": "user", "content": "Текст диалога:\n" + dialogue + "\n\nАтомарный вопрос:\n" + request["question"]}]


def prepare_inputs(tokenizer, messages):
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    inputs = tokenizer(text, return_tensors="pt", truncation=False)
    if inputs["input_ids"].shape[1] > 2048:
        raise InputLimit()
    return inputs.to("cuda:0")


def load_runtime(contract: dict, *, importer=importlib.import_module):
    """Only an explicit external batch invocation reaches the pinned CUDA loader."""
    try:
        torch = importer("torch")
    except (ImportError, OSError) as error:
        raise RuntimeUnavailable("PACKAGES_UNAVAILABLE") from error
    try:
        cuda_available = torch.cuda.is_available()
    except Exception as error:
        raise RuntimeUnavailable("CUDA_RUNTIME_UNAVAILABLE") from error
    if not cuda_available:
        raise RuntimeUnavailable("CUDA_UNAVAILABLE")
    try:
        transformers = importer("transformers")
    except (ImportError, OSError) as error:
        raise RuntimeUnavailable("PACKAGES_UNAVAILABLE") from error
    specification = contract["model"]
    try:
        torch.manual_seed(0)
        torch.cuda.manual_seed_all(0)
        torch.backends.cudnn.benchmark = False
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.use_deterministic_algorithms(True)
        tokenizer = transformers.AutoTokenizer.from_pretrained(specification["id"], revision=specification["revision"], trust_remote_code=False)
        model = transformers.AutoModelForCausalLM.from_pretrained(specification["id"], revision=specification["revision"], dtype=torch.float16,
                                                                device_map={"": "cuda:0"}, attn_implementation="sdpa", trust_remote_code=False).eval()
        torch.cuda.synchronize()
        if (getattr(model, "is_loaded_in_4bit", False) or getattr(model, "is_loaded_in_8bit", False)
                or any(str(parameter.device) != "cuda:0" or parameter.dtype != torch.float16 for parameter in model.parameters())):
            raise RuntimeUnavailable("FROZEN_RUNTIME_SUBSTITUTION_REJECTED")
        generation = transformers.GenerationConfig(do_sample=False, temperature=None, top_p=None, top_k=None, max_new_tokens=8, repetition_penalty=1.0,
                                                  pad_token_id=tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id,
                                                  eos_token_id=model.generation_config.eos_token_id, use_cache=True)
    except RuntimeUnavailable:
        raise
    except OSError as error:
        raise RuntimeUnavailable("PINNED_MODEL_UNAVAILABLE") from error
    except Exception as error:
        raise RuntimeUnavailable("RUNTIME_INITIALIZATION_UNAVAILABLE") from error

    def infer(_request, messages):
        begin = time.perf_counter()
        inputs = prepare_inputs(tokenizer, messages)
        with torch.inference_mode():
            output = model.generate(**inputs, generation_config=generation, max_time=30)
        torch.cuda.synchronize()
        if (time.perf_counter() - begin) * 1000 > 30000:
            raise TimeoutError("CASE_TIMEOUT")
        output_tokens = output[0, inputs["input_ids"].shape[1]:]
        return tokenizer.decode(output_tokens, skip_special_tokens=True).strip()

    versions = {"python": platform.python_version(), "torch": str(torch.__version__), "transformers": str(transformers.__version__),
                "cuda": str(torch.version.cuda), "dtype": "float16", "device": "cuda:0", "attention": "sdpa", "settings": _json(contract["settings"])}
    return infer, versions


def execute_requests(requests, contract, infer, *, clock=time.perf_counter):
    """A single inference seam; fatal/timeout work stops, every id stays accounted."""
    stopped = False
    for request in requests:
        row = {"id": request["id"], "status": "ERROR", "raw_output": None, "latency_ms": None}
        if stopped:
            yield row
            continue
        begin = clock()
        try:
            answer = infer(request, format_messages(request, contract["systemPrompt"]))
            latency = (clock() - begin) * 1000
            if latency > 30000:
                row["status"] = "TIMEOUT"
                stopped = True
            elif isinstance(answer, str) and answer.strip() in LABELS:
                row.update(status="OK", raw_output=answer.strip())
            else:
                # Do not retain partial labels, explanations or thinking text.
                row["status"] = "INVALID"
            row["latency_ms"] = latency
        except InputLimit:
            row.update(status="INPUT_LIMIT", latency_ms=(clock() - begin) * 1000)
        except TimeoutError:
            row.update(status="TIMEOUT", latency_ms=(clock() - begin) * 1000)
            stopped = True
        except Exception:
            row["latency_ms"] = (clock() - begin) * 1000
            stopped = True
        yield row


def _write_json(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(_json(value) + "\n")


def run_batch(manifest_path: Path, requests_path: Path, contract_path: Path, output_dir: Path, *, runtime_factory=None) -> dict:
    manifest = _strict_json(Path(manifest_path).read_bytes())
    contract_bytes = Path(contract_path).read_bytes()
    if _sha(contract_bytes) != CONTRACT_SHA256:
        raise ValueError("CONTRACT_BYTES_DRIFT")
    contract = _strict_json(contract_bytes)
    requests = validate_bundle(manifest, Path(requests_path).read_bytes(), contract)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=False)
    provenance = {"schemaVersion": 1, **{key: manifest[key] for key in ("runId", "inputSha256", "contractSha256", "model", "promptHash", "settingsHash")}}
    runtime_identity = {"runner": RUNNER, "runtimeReferenceHash": contract["runtimeReferenceHash"]}
    try:
        infer, versions = (runtime_factory or load_runtime)(contract)
    except RuntimeUnavailable as error:
        marker = {**provenance, "status": "SKIP", "reason": str(error), "runtimeIdentity": runtime_identity}
        _write_json(output_dir / "runtime-status.json", marker)
        return marker
    if (not callable(infer) or not isinstance(versions, dict) or not versions
            or not all(_nonempty(key) and _nonempty(value) for key, value in versions.items())):
        raise ValueError("RUNTIME_IDENTITY_SCHEMA")
    response_hash = hashlib.sha256()
    with (output_dir / "responses.jsonl").open("xb") as stream:
        for row in execute_requests(requests, contract, infer):
            data = (_json(row) + "\n").encode("utf-8")
            stream.write(data)
            stream.flush()
            response_hash.update(data)
    result = {**provenance, "responsesSha256": response_hash.hexdigest(), "runtimeIdentity": {**runtime_identity, "versions": versions}}
    _write_json(output_dir / "response-manifest.json", result)
    return result


def self_test():
    """Protocol/runner behavior, never a GPU smoke or model execution."""
    authority_path = Path(__file__).parent.parent / "references/semantic-scout-contract.json"
    contract_bytes = authority_path.read_bytes()
    authority = json.loads(contract_bytes)

    def fixture(requests=None):
        requests = requests if requests is not None else [
            {"id": "a" * 64, "turns": [{"speaker": "agent", "text": "Рассмотрим ипотеку?"},
                                      {"speaker": "client", "text": "Нет."}],
             "question": authority["questionRegistry"]["mortgage_permission"]},
            {"id": "b" * 64, "turns": [{"speaker": "client", "text": "Пока не знаю."}],
             "question": authority["questionRegistry"]["mortgage_permission"]},
            {"id": "c" * 64, "turns": [{"speaker": "client", "text": "Позже."}],
             "question": authority["questionRegistry"]["mortgage_permission"]},
        ]
        digest = lambda value: hashlib.sha256(value).hexdigest()
        canonical_hash = lambda value: digest(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                                         separators=(",", ":")).encode("utf-8"))
        data = b"".join((json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8") for row in requests)
        manifest = {
            "schemaVersion": 1, "runId": "stdlib-unit", "sourceHead": "d" * 40,
            "sourceHashes": {"local-source": "e" * 64}, "inputSha256": digest(data),
            "requestIds": [row["id"] for row in requests], "contractSha256": digest(contract_bytes),
            "model": authority["model"], "promptHash": authority["promptHash"], "settingsHash": authority["settingsHash"],
            "policyVersion": authority["policyVersion"],
            "policyHash": canonical_hash({key: authority[key] for key in ("policy", "questionPolicy", "slicePolicy")}),
            "projectionHash": canonical_hash(authority["projections"]),
            "questionRegistryHash": canonical_hash(authority["questionRegistry"]),
            "fingerprintVersion": authority["fingerprintVersion"],
            "fingerprintHash": canonical_hash({"version": authority["fingerprintVersion"]}),
            "runnerIdentity": "transformers-batch-v1", "selection": {"observed": len(requests), "selected": len(requests), "rejected": 0},
        }
        return manifest, data, requests

    class AdapterTests(unittest.TestCase):
        def test_required_functions_exist(self):
            for name in ("validate_bundle", "format_messages", "run_batch", "execute_requests", "load_runtime"):
                self.assertTrue(callable(globals().get(name)), "missing adapter function: " + name)

        def test_exact_original_messages_exclude_ids_and_metadata(self):
            request = fixture()[2][0]
            messages = format_messages(request, "fixed system")
            self.assertEqual(messages, [
                {"role": "system", "content": "fixed system"},
                {"role": "user", "content": "Текст диалога:\nАгент: Рассмотрим ипотеку?\nКлиент: Нет.\n\nАтомарный вопрос:\nКлиент сейчас допускает рассмотрение ипотеки для своей покупки?"},
            ])
            self.assertNotIn(request["id"], json.dumps(messages))

        def test_valid_bundle_preserves_full_ordered_prefix(self):
            manifest, data, requests = fixture()
            self.assertEqual(validate_bundle(manifest, data, authority), requests)

        def test_wrong_missing_duplicate_and_readable_ids_rejected(self):
            for ids in (["f" * 64], ["a" * 64, "b" * 64], ["a" * 64] * 3, ["fixture:NO"] * 3):
                manifest, data, _ = fixture()
                manifest["requestIds"] = ids
                manifest["selection"] = {"observed": len(ids), "selected": len(ids), "rejected": 0}
                with self.assertRaises(ValueError):
                    validate_bundle(manifest, data, authority)

        def test_request_schema_question_and_private_metadata_rejected(self):
            for key, value in (("gold", "NO"), ("core", "NO"), ("question", "changed question"), ("id", "fixture:NO")):
                requests = fixture()[2]
                requests[0][key] = value
                manifest, data, _ = fixture(requests)
                with self.assertRaises(ValueError):
                    validate_bundle(manifest, data, authority)
            requests = fixture()[2]
            requests[0]["turns"][0]["gold"] = "NO"
            manifest, data, _ = fixture(requests)
            with self.assertRaises(ValueError):
                validate_bundle(manifest, data, authority)

        def test_frozen_provenance_and_settings_rejected(self):
            for key in ("contractSha256", "inputSha256", "promptHash", "settingsHash", "policyHash", "projectionHash", "questionRegistryHash", "fingerprintHash"):
                manifest, data, _ = fixture()
                manifest[key] = "0" * 64
                with self.assertRaises(ValueError):
                    validate_bundle(manifest, data, authority)
            changed = copy.deepcopy(authority)
            changed["settings"]["repetition_penalty"] = 1
            with self.assertRaises(ValueError):
                validate_bundle(*fixture()[:2], changed)
            changed = copy.deepcopy(authority)
            changed["model"]["revision"] = "0" * 40
            with self.assertRaises(ValueError):
                validate_bundle(*fixture()[:2], changed)

        def test_strict_jsonl_bytes(self):
            manifest, data, _ = fixture()
            for bad in (data + b" ", data.replace(b"\n", b"\r\n"), b"\xef\xbb\xbf" + data, data[:-1], b"\xff\n"):
                changed = copy.deepcopy(manifest)
                changed["inputSha256"] = hashlib.sha256(bad).hexdigest()
                with self.assertRaises(ValueError):
                    validate_bundle(changed, bad, authority)
            duplicate_key = data.replace(b'"id":', b'"id":"discarded","id":', 1)
            manifest["inputSha256"] = hashlib.sha256(duplicate_key).hexdigest()
            with self.assertRaises(ValueError):
                validate_bundle(manifest, duplicate_key, authority)

        def test_labels_invalid_reasoning_and_input_limit(self):
            requests = fixture()[2]
            def infer(request, _messages):
                if request["id"] == "a" * 64:
                    return " NO\n"
                if request["id"] == "b" * 64:
                    return "<think>private reasoning</think>YES"
                raise InputLimit()
            rows = list(execute_requests(requests, authority, infer))
            self.assertEqual([(row["status"], row["raw_output"]) for row in rows], [("OK", "NO"), ("INVALID", None), ("INPUT_LIMIT", None)])
            self.assertEqual([row["id"] for row in rows], [row["id"] for row in requests])

        def test_timeout_and_error_stop_remaining_work(self):
            for failure, status in ((TimeoutError(), "TIMEOUT"), (RuntimeError("private diagnostic"), "ERROR")):
                calls = []
                def infer(request, _messages):
                    calls.append(request["id"])
                    if len(calls) == 1:
                        return "UNKNOWN"
                    raise failure
                rows = list(execute_requests(fixture()[2], authority, infer))
                self.assertEqual([row["status"] for row in rows], ["OK", status, "ERROR"])
                self.assertEqual([row["raw_output"] for row in rows], ["UNKNOWN", None, None])
                self.assertEqual(len(calls), 2)
                self.assertNotIn("private", json.dumps(rows))

        def test_wall_timeout_discards_answer_and_stops(self):
            ticks = iter([0, 31])
            rows = list(execute_requests(fixture()[2], authority, lambda *_: "YES", clock=lambda: next(ticks)))
            self.assertEqual([row["status"] for row in rows], ["TIMEOUT", "ERROR", "ERROR"])
            self.assertTrue(all(row["raw_output"] is None for row in rows))

        def test_chat_template_and_token_boundary_precede_cuda_transfer(self):
            class Inputs(dict):
                def to(self, device):
                    self["moved"] = device
                    return self
            class Tokenizer:
                def __init__(self, count):
                    self.count = count
                def apply_chat_template(self, messages, **kwargs):
                    self.messages, self.template_options = messages, kwargs
                    return "untruncated-template"
                def __call__(self, text, **kwargs):
                    self.text, self.token_options = text, kwargs
                    class Tokens:
                        shape = (1, self.count)
                    self.inputs = Inputs(input_ids=Tokens())
                    return self.inputs
            messages = format_messages(fixture()[2][0], authority["systemPrompt"])
            accepted = Tokenizer(2048)
            self.assertEqual(prepare_inputs(accepted, messages)["moved"], "cuda:0")
            self.assertEqual(accepted.template_options, {"tokenize": False, "add_generation_prompt": True, "enable_thinking": False})
            self.assertEqual(accepted.token_options, {"return_tensors": "pt", "truncation": False})
            self.assertEqual(accepted.messages, messages)
            rejected = Tokenizer(2049)
            with self.assertRaises(InputLimit):
                prepare_inputs(rejected, messages)
            self.assertNotIn("moved", rejected.inputs)

        def test_runtime_missing_packages_or_cuda_skips_before_loading(self):
            def missing(_name):
                raise ModuleNotFoundError("private path")
            with self.assertRaisesRegex(RuntimeUnavailable, "PACKAGES_UNAVAILABLE"):
                load_runtime(authority, importer=missing)
            class NoCuda:
                class cuda:
                    @staticmethod
                    def is_available():
                        return False
            def no_cuda(name):
                self.assertEqual(name, "torch")
                return NoCuda
            with self.assertRaisesRegex(RuntimeUnavailable, "CUDA_UNAVAILABLE"):
                load_runtime(authority, importer=no_cuda)

        def test_broken_native_package_or_cuda_precondition_is_unavailable(self):
            def broken_package(_name):
                raise OSError("private native library path")
            with self.assertRaisesRegex(RuntimeUnavailable, "PACKAGES_UNAVAILABLE"):
                load_runtime(authority, importer=broken_package)
            class BrokenCuda:
                class cuda:
                    @staticmethod
                    def is_available():
                        raise RuntimeError("private CUDA diagnostic")
            with self.assertRaisesRegex(RuntimeUnavailable, "CUDA_RUNTIME_UNAVAILABLE"):
                load_runtime(authority, importer=lambda _: BrokenCuda)

        def test_run_byte_validation_precedes_runtime_and_output(self):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                manifest, data, _ = fixture()
                (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                (root / "requests.jsonl").write_bytes(data + b" ")
                with patch(__name__ + ".load_runtime", side_effect=AssertionError("runtime must remain unloaded")):
                    with self.assertRaises(ValueError):
                        run_batch(root / "manifest.json", root / "requests.jsonl", authority_path, root / "out")
                self.assertFalse((root / "out").exists())
                (root / "requests.jsonl").write_bytes(data)
                tampered = root / "contract.json"
                tampered.write_bytes(contract_bytes + b"\n")
                with self.assertRaises(ValueError):
                    run_batch(root / "manifest.json", root / "requests.jsonl", tampered, root / "out")

        def test_skip_closed_marker_no_fake_rows_and_exclusive_output(self):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                manifest, data, _ = fixture()
                (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                (root / "requests.jsonl").write_bytes(data)
                def unavailable(_contract):
                    raise RuntimeUnavailable("CUDA_UNAVAILABLE")
                marker = run_batch(root / "manifest.json", root / "requests.jsonl", authority_path, root / "out", runtime_factory=unavailable)
                self.assertEqual(marker["status"], "SKIP")
                self.assertEqual(set(marker), {"schemaVersion", "status", "reason", "runId", "inputSha256", "contractSha256", "model", "promptHash", "settingsHash", "runtimeIdentity"})
                self.assertEqual(marker["runtimeIdentity"], {"runner": "transformers-batch-v1", "runtimeReferenceHash": authority["runtimeReferenceHash"]})
                self.assertEqual(sorted(path.name for path in (root / "out").iterdir()), ["runtime-status.json"])
                with self.assertRaises(FileExistsError):
                    run_batch(root / "manifest.json", root / "requests.jsonl", authority_path, root / "out", runtime_factory=unavailable)

        def test_response_manifest_hash_versions_and_all_ids(self):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                manifest, data, _ = fixture()
                (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                (root / "requests.jsonl").write_bytes(data)
                result = run_batch(root / "manifest.json", root / "requests.jsonl", authority_path, root / "out",
                                   runtime_factory=lambda _: (lambda *_: "YES", {"python": "stdlib-stub"}))
                responses = (root / "out" / "responses.jsonl").read_bytes()
                self.assertEqual(result["responsesSha256"], hashlib.sha256(responses).hexdigest())
                self.assertEqual([json.loads(row)["id"] for row in responses.splitlines()], manifest["requestIds"])
                self.assertEqual(set(result), {"schemaVersion", "runId", "inputSha256", "contractSha256", "model", "promptHash", "settingsHash", "responsesSha256", "runtimeIdentity"})
                self.assertEqual(result["runtimeIdentity"]["versions"], {"python": "stdlib-stub"})
                self.assertFalse((root / "out" / "runtime-status.json").exists())

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(AdapterTests)
    if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    for name in ("manifest", "requests", "contract", "out"):
        parser.add_argument("--" + name, type=Path, default=os.environ.get("SCOUT_" + name.upper()))
    args = parser.parse_args()
    if args.self_test:
        if any(getattr(args, name) is not None for name in ("manifest", "requests", "contract", "out")):
            parser.error("--self-test cannot be combined with runtime paths or SCOUT_* defaults")
        self_test()
    else:
        if any(getattr(args, name) is None for name in ("manifest", "requests", "contract", "out")):
            parser.error("explicit --manifest --requests --contract --out paths (or SCOUT_* defaults) required")
        try:
            result = run_batch(args.manifest, args.requests, args.contract, args.out)
        except (ValueError, OSError):
            print("SCOUT_ADAPTER_STOP: invalid input or output destination", file=sys.stderr)
            raise SystemExit(1)
        print("SKIP" if result.get("status") == "SKIP" else "BUNDLE_WRITTEN")
