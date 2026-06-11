export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, context } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.' });

  // 페이지 파싱
  const pages = [];
  for (const chunk of context.split(/(?=\n?=== \[)/)) {
    const m = chunk.match(/=== \[(.+?)\] ===/);
    if (!m) continue;
    pages.push({ title: m[1], content: chunk.replace(/=== \[.+?\] ===\n?/, '').trim() });
  }

  // 키워드 점수 기반 관련 페이지 선택
  const qLower = question.toLowerCase();
  const qKeywords = qLower.split(/[\s,./()[\]"']+/).filter(w => w.length >= 2);

  const scored = pages.map(p => {
    const tl = p.title.toLowerCase();
    const cl = p.content.toLowerCase();
    let score = 0;
    qKeywords.forEach(kw => {
      if (tl === kw) score += 20;
      else if (tl.includes(kw)) score += 8;
      score += (cl.split(kw).length - 1);
    });
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  const relevant = scored.length > 0 ? scored.slice(0, 40) : pages.slice(0, 15);

  // 상위 10개 전문, 나머지 3000자
  const filteredCtx = relevant.map((p, i) =>
    `=== [${p.title}] ===\n${i < 10 ? p.content : p.content.substring(0, 3000)}`
  ).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래 기획서 원문을 분석해서 질문에 정확하고 상세하게 답해.

[절대 규칙]
1. 질문과 직접 관련된 내용만 답해. 관련 없는 내용은 절대 포함하지 마.
2. 기획서 원문에 있는 수치, 공식, 조건, 예외사항을 빠짐없이 포함해.
3. 제목/서브제목 뒤에 [[페이지명]] 출처를 붙여. 단, 같은 페이지는 처음 1번만 표시해.
   올바른 예:
   ## 경직 시스템 [[경직]]
   ### 경직 시간 계산
   - 내용...
   ### 블렌딩 시간
   - 내용...
   (같은 페이지면 ## 제목에만 [[]] 붙이고, ### 소제목엔 반복하지 마)
4. [[페이지명]]은 반드시 완전하게 ]]로 닫을 것. 불완전한 [[ 절대 금지.
5. 페이지명은 아래 목록에서만 사용할 것.
6. 여러 페이지에 걸친 내용은 페이지별로 나눠서 모두 포함해.
7. 기획서에 없는 내용은 "기획서에서 찾을 수 없습니다"라고만 해.
8. 한국어로 답해.
9. 구조: ## 대제목 [[출처]], ### 소제목, - 항목, 수치는 **굵게**.
10. 답변 끝에 불필요한 내용 추가 금지. 질문 범위만 답할 것.

[사용 가능한 페이지 목록]
${relevant.map(p => '- ' + p.title).join('\n')}

[기획서 원문]
${filteredCtx}

[질문]
${question}`;

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
              generationConfig: { temperature: 0.0, maxOutputTokens: 4000 }
            })
          }
        );
        const data = await response.json();
        if (data.error) {
          if (data.error.code === 429 || data.error.status === 'RESOURCE_EXHAUSTED') {
            if (attempt === 0) { await sleep(2500); continue; }
            break;
          }
          throw new Error(data.error.message);
        }
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!raw) break;

        // 서버 후처리: 불완전한 [[ 제거
        const cleaned = raw.replace(/\[\[(?![^\]]*\]\])[^\n]*/g, '');
        return res.json({ success: true, answer: cleaned, model });
      } catch (e) {
        if (attempt === 1) break;
        await sleep(1000);
      }
    }
  }

  return res.status(429).json({
    error: 'API 요청 한도에 도달했어요. 잠시 후 다시 질문해주세요.'
  });
}
