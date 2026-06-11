export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, context } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.' });

  // 키워드 기반 관련 페이지 추출
  const pages = [];
  for (const chunk of context.split(/(?=\n?=== \[)/)) {
    const m = chunk.match(/=== \[(.+?)\] ===/);
    if (!m) continue;
    pages.push({ title: m[1], content: chunk.replace(/=== \[.+?\] ===\n?/, '').trim() });
  }

  const qLower = question.toLowerCase();
  const qKeywords = qLower.split(/[\s,./()[\]]+/).filter(w => w.length >= 2);

  const scored = pages.map(p => {
    const tl = p.title.toLowerCase(), cl = p.content.toLowerCase();
    let score = 0;
    qKeywords.forEach(kw => {
      if (tl.includes(kw)) score += 5;
      score += (cl.split(kw).length - 1);
    });
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  const relevant = scored.length > 0 ? scored.slice(0, 40) : pages.slice(0, 15);
  const filteredCtx = relevant.map((p, i) =>
    `=== [${p.title}] ===\n${i < 8 ? p.content : p.content.substring(0, 2500)}`
  ).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래 기획서 원문을 바탕으로 질문에 답해.

[핵심 규칙]
1. 기획서 원문에 있는 내용을 빠짐없이 상세하게 답해. 절대 생략하지 마.
2. 수치, 공식, 조건, 예외사항까지 전부 포함해.
3. 제목/서브제목 뒤에 반드시 [[페이지명]] 형식으로 출처 표시.
   예: ## 경직 시스템 [[경직]]
4. 여러 페이지에 걸친 내용이면 모두 포함해.
5. 기획서에 없는 내용만 "기획서에서 찾을 수 없습니다"라고 해.
6. 한국어로, ## 제목 / ### 소제목 / - 항목 구조로 답해.
7. 수치는 **굵게** 표시.

[기획서 원문]
${filteredCtx}

[질문]
${question}`;

  // 모델 목록 - rate limit 시 순차 시도 + 대기 후 재시도
  // 2026년 6월 기준 무료 티어 사용 가능 모델
  // gemini-2.0-flash, gemini-2.0-flash-lite는 2026-06-01 종료됨
  const models = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash-8b',
    'gemini-1.5-flash-latest',
  ];

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.05, maxOutputTokens: 4000 }
            })
          }
        );
        const data = await response.json();

        if (data.error) {
          // 429 rate limit → 잠깐 기다렸다가 다음 모델
          if (data.error.code === 429 || data.error.status === 'RESOURCE_EXHAUSTED') {
            if (attempt === 0) { await sleep(2000); continue; } // 2초 후 한 번 더
            break; // 다음 모델로
          }
          throw new Error(data.error.message);
        }

        const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!answer) break;
        return res.json({ success: true, answer, model });
      } catch (e) {
        if (attempt === 1) break;
        await sleep(1000);
      }
    }
  }

  // 모든 모델 실패 시 사용자 친화적 메시지
  return res.status(429).json({
    error: 'API 요청 한도에 도달했어요. 잠시 후 다시 질문해주세요. (무료 플랜은 분당 요청 횟수 제한이 있어요)'
  });
}
