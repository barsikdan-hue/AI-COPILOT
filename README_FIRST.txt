AI Copilot 4.0.2-rc.5 — semantic core / objection flow

LIVE START (Windows):
1) Copy .env.example to .env
2) Put GEMINI_API_KEY into .env
3) Double-click START_LIVE_GEMINI.bat
4) Open http://localhost:3000

Main RC4 changes:
- video refusal is no longer counted as PPV agreement
- "send prices/plans instead" after a video proposal is treated as PPV resistance
- repeated PPV refusal blocks repeated video pressure until client reopens the branch
- negative mortgage intent no longer becomes Mortgage
- "Krasnaya Polyana not considering" no longer rejects Sochi/Sirius
- "residential complex" is recognized as property type in context
- down-payment context survives short agent asides
- Gemini remote analysis is throttled harder during resistance/boundary mode
