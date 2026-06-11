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
      if (tl === kw) score += 20;          // 완전 일치
      else if (tl.includes(kw)) score += 8; // 제목 포함
      score += (cl.split(kw).length - 1);   // 본문 빈도
    });
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  const relevant = scored.length > 0 ? scored.slice(0, 45) : pages.slice(0, 20);

  // 상위 10개 전문, 나머지 3000자
  const filteredCtx = relevant.map((p, i) =>
    `=== [${p.title}] ===\n${i < 10 ? p.content : p.content.substring(0, 3000)}`
  ).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래 기획서 원문을 분석해서 질문에 정확하고 상세하게 답해.

[절대 규칙 - 반드시 지켜야 함]
1. 기획서 원문에 있는 모든 관련 내용을 빠짐없이 포함해. 절대 생략 금지.
2. 수치, 공식, 조건, 예외사항, 테이블 데이터까지 전부 원문 그대로 인용해.
3. 제목/서브제목 바로 뒤에 반드시 [[페이지명]] 형식으로 출처를 붙여.
   올바른 예: ## 경직 시스템 [[경직]]
   올바른 예: ### 경직 시간 계산 [[경직]]
   금지: [[페이지 - 금지: [[페 (반드시 완성된 형태만 사용)
4. [[페이지명]] 안에 들어가는 이름은 반드시 기획서 원문의 실제 페이지 제목과 정확히 일치해야 함.
5. 여러 페이지에 관련 내용이 있으면 모두 찾아서 포함해.
6. 기획서에 없는 내용만 "기획서에서 찾을 수 없습니다"라고 해.
7. 반드시 한국어로 답해.
8. 구조: ## 대제목 [[출처]], ### 소제목 [[출처]], - 항목, 수치는 **굵게**.
9. [[페이지명]]은 반드시 완전하게 닫아야 함. ]]로 반드시 끝내야 함.

[사용 가능한 페이지 제목 목록 (이 중에서만 [[]] 사용)]
${relevant.map(p => '- ' + p.title).join('\n')}

[기획서 원문 - 관련 ${relevant.length}개 페이지]
${filteredCtx}

[질문]
${question}

위 질문에 대해 기획서 내용을 빠짐없이 상세하게 답해. [[페이지명]]은 반드시 완전하게 ]]로 닫아야 함.`;

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
        const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!answer) break;

        // [[페이지명 끊김 후처리: 닫히지 않은 [[ 제거
        const cleaned = answer.replace(/\[\[(?![^\]]*\]\])[^\n]*/g, '');
        return res.json({ success: true, answer: cleaned, model });
      } catch (e) {
        if (attempt === 1) break;
        await sleep(1000);
      }
    }
  }

  return res.status(429).json({
    error: 'API 요청 한도에 도달했어요. 잠시 후 다시 질문해주세요. (무료 플랜은 분당 요청 횟수 제한이 있어요)'
  });
}
