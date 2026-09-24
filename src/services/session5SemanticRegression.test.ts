import { describe, expect, it } from 'vitest';
import { createInitialState } from './conversationStore';
import { advanceLocalConversation, buildLocalAnalysisResponse } from './localAnalysisEngine';
import type { ConversationState, TranscriptTurn } from '../types';

type Speaker = 'agent' | 'client';

function replay(lines: Array<[Speaker, string]>) {
  let state = createInitialState();
  const turns: TranscriptTurn[] = [];
  const hints: Array<{ text: string | null; state: ConversationState; clientText: string }> = [];

  lines.forEach(([speaker, text], index) => {
    const turn: TranscriptTurn = {
      id: `s5-${index + 1}`,
      sessionId: 'session5-regression',
      speaker,
      source: speaker === 'client' ? 'call_audio' : 'microphone',
      text,
      timestamp: 1_790_000_000_000 + index * 1000,
      isFinal: true,
      revision: index + 1,
    };
    turns.push(turn);
    const advanced = advanceLocalConversation(state, turn, turns);
    state = advanced.state;

    if (speaker === 'client') {
      const response = buildLocalAnalysisResponse({
        sessionId: 'session5-regression',
        revision: index + 1,
        newTurns: [turn],
        recentTurns: turns.slice(-12),
        currentState: state,
      });
      hints.push({ text: response.suggestedReply, state, clientText: text });
    }
  });

  return { state, turns, hints };
}

describe('session 5 semantic core regression', () => {
  const dialogue: Array<[Speaker, string]> = [
    ['client', 'Я просто хотел взглянуть на варианты, без лишних формальностей.'],
    ['agent', 'В Сочи давно рассматриваете или только начали изучать рынок?'],
    ['client', 'Смотрю где-то месяц. Часть денег лежит без дела, но если что-то брать, иногда и для отдыха пригодится.'],
    ['agent', 'Что уже успели посмотреть?'],
    ['client', 'Я уже несколько объектов видел в Сочи и Анапе, презентаций штук 20 в ватсапе. Я в них запутался и не понимаю, чем они отличаются.'],
    ['agent', 'Как обычно любите проводить время, когда приезжаете в Сочи?'],
    ['client', 'Если место будет хорошее, сам буду приезжать, но важно, чтобы это было разумное вложение денег.'],
    ['agent', 'Кто будет пользоваться недвижимостью?'],
    ['client', 'Дети у меня уже взрослые, одному 22, второму 19.'],
    ['agent', 'Предлагаю на 15 минут подключиться к видеопоказу. Вам сегодня в 18:00 или завтра?'],
    ['client', 'Нет, видеовстречу сейчас не хочу. Я не готов час на обычную презентацию тратить. Давайте без давления.'],
    ['agent', 'Что из того, что уже видели, не устроило больше всего?'],
    ['client', 'Я с другим агентом общался. Он прислал мне штук 20 объектов, и я вообще не понял, чем они отличаются.'],
    ['agent', 'До какой максимальной суммы рассматриваете покупку?'],
    ['client', 'Наверное, до 30 млн. Если действительно что-то интересное, то посмотрю и 35-40, если реально стоящая история.'],
    ['agent', 'Какие два-три критерия для вас решающие?'],
    ['client', 'Хорошая локация и возможность сдавать объект.'],
    ['agent', 'Что ещё важно?'],
    ['client', 'Ликвидность, адекватная цена и нормальная инфраструктура.'],
    ['agent', 'К какому сроку планируете определиться?'],
    ['client', 'Если найду нормальный вариант, в ближайшие 2-3 месяца могу принять решение.'],
    ['agent', 'Какой первоначальный взнос планируете задействовать?'],
    ['client', 'Скорее своими средствами. Я вообще ипотеку не хочу. Если рассрочка от застройщика нормальная, тогда посмотрю.'],
    ['agent', 'Средства уже на руках или планируете продажу актива?'],
    ['client', 'Это уже на руках. Продавать ничего не планирую, просто деньги лежат.'],
    ['agent', 'Что сейчас вызывает наибольшие сомнения?'],
    ['client', 'Не уверен, что есть смысл переплачивать. Может, рынок остынет и цены упадут.'],
    ['agent', 'И к чему это приводит для решения?'],
    ['client', 'Если рынок остынет, я просто подожду. Мне не горит, хочу понять, что действительно разумно.'],
    ['agent', 'Что сейчас важнее сравнить?'],
    ['client', 'И цены, и формат, и доходность. Всё важно, если это не пустой разговор.'],
    ['agent', 'Какую доходность считаете разумной?'],
    ['client', 'Не меньше, чем на депозите. Смотря какие условия.'],
    ['agent', 'Предлагаю коротко на 15 минут посмотреть 2–3 варианта и расчёты. Сегодня в 18:00 или завтра в 13:00?'],
    ['client', 'Давайте коротко созвонимся и посмотрим. Время предложите вы.'],
    ['agent', 'Сегодня в 18:00 зафиксируем.'],
    ['client', 'Пусть будет 18:00.'],
  ];

  it('credits meaning consistently instead of exact card wording', () => {
    const { state } = replay(dialogue);

    expect(state.familyMortgage?.value).toMatch(/взросл|совершеннолет/iu);
    expect(state.familyMortgage?.needsClarification).toBe(false);
    expect(state.scriptProgress?.metrics.familyMortgage.status).toBe('not_applicable');

    // Mentioning adult children is not evidence that family/spouse co-decides.
    expect(state.decisionMakers?.value || '').not.toMatch(/совмест|супруг/iu);
    expect(state.scriptProgress?.metrics.decisionMaker.status).not.toBe('confirmed');

    const criteriaTexts = (state.criteria?.items || []).map((item) => item.text);
    expect(criteriaTexts).toEqual(expect.arrayContaining([
      expect.stringMatching(/локац/iu),
      expect.stringMatching(/сдава|аренд/iu),
      expect.stringMatching(/ликвид/iu),
      expect.stringMatching(/цен/iu),
      expect.stringMatching(/инфраструкт/iu),
    ]));
    expect(state.scriptProgress?.metrics.criteria.status).toBe('confirmed');

    expect(state.searchExperience?.value).toMatch(/агент|просмотр|рынок/iu);
    expect(state.scriptProgress?.metrics.experience.status).toBe('confirmed');

    expect(state.downPayment?.value).toMatch(/на руках|доступ/iu);
    expect(state.scriptProgress?.metrics.downPayment.status).toBe('confirmed');

    expect(state.budget?.isFlexible).toBe(true);
    expect(state.budget?.value).toMatch(/30/);
    expect(`${state.budget?.value} ${state.budget?.comment || ''}`).toMatch(/35-40/);

    expect(state.scriptProgress?.metrics.ppi.status).toBe('not_applicable');
    expect(state.scriptProgress?.metrics.ppi.value).toMatch(/не требуется|исключена/iu);

    expect(state.nextStepAgreement?.status).toBe('agreed');
    expect(state.scriptProgress?.metrics.ppv.status).toBe('confirmed');
    expect(state.scriptProgress?.ppv.clientAgreed).toBe(true);
  });

  it('does not go silent on substantive client turns and handles the active objection', () => {
    const { hints } = replay(dialogue);
    const substantive = hints.filter((item) => item.clientText.trim().length >= 18);
    const silent = substantive.filter((item) => !item.text?.trim());
    expect(silent).toEqual([]);

    const videoRefusal = hints.find((item) => item.clientText.includes('не готов час'));
    expect(videoRefusal?.text).toMatch(/15 минут|что именно|формат|видео/iu);
    expect(videoRefusal?.text).not.toMatch(/квартира или апартаменты/iu);

    const marketObjection = hints.find((item) => item.clientText.includes('рынок остынет'));
    expect(marketObjection?.text).toMatch(/рынок|пауза|снижен|цена|ждать|ориентир/iu);

    const yieldObjection = hints.find((item) => item.clientText.includes('депозите'));
    expect(yieldObjection?.text).toMatch(/депозит|доход|денежн|процент|результат/iu);
  });

  it('is idempotent when a semantically equivalent criteria answer is repeated', () => {
    const base = dialogue.slice(0, 19);
    const { state: once } = replay(base);
    const { state: twice } = replay([
      ...base,
      ['agent', 'Повторю: что для вас принципиально при выборе?'],
      ['client', 'Мне важны локация, ликвидность, возможность аренды, адекватная цена и инфраструктура.'],
    ]);

    const normalize = (items: Array<string | { text: string }> = []) =>
      Array.from(new Set(items.map((item) => typeof item === 'string' ? item : item.text))).sort();
    expect(normalize(twice.criteria?.items)).toEqual(normalize(once.criteria?.items));
    expect(normalize(twice.criteria?.items).length).toBe((twice.criteria?.items || []).length);
    expect(twice.scriptProgress?.metrics.criteria.status).toBe('confirmed');
    expect(once.scriptProgress?.metrics.criteria.status).toBe('confirmed');
  });
});
