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

  // 키워드 동의어 확장 (자주 쓰는 표현 → 실제 기획서 키워드)
  const synonyms = {
    '로드맵': ['로드맵', '마일스톤', '계획', '일정', '스케줄'],
    '패치': ['패치', 'M56', 'M55', 'M54', 'M53', '업데이트', '버전'],
    '전투': ['전투', '스킬', '밸런스', '경직', '공격', '방어'],
    '캐릭터': ['캐릭터', '직업', '속도', '능력치'],
    '콘텐츠': ['콘텐츠', '던전', '필드', '레이드', '보스'],
  };

  const qLower = question.toLowerCase();
  let expandedKeywords = qLower.split(/[\s,./()[\]"']+/).filter(w => w.length >= 2);

  // 동의어 확장
  Object.keys(synonyms).forEach(key => {
    if (qLower.includes(key)) {
      expandedKeywords = expandedKeywords.concat(synonyms[key]);
    }
  });
  expandedKeywords = [...new Set(expandedKeywords)];

  const scored = pages.map(p => {
    const tl = p.title.toLowerCase();
    const cl = p.content.toLowerCase();
    let score = 0;
    expandedKeywords.forEach(kw => {
      if (tl === kw) score += 20;
      else if (tl.includes(kw)) score += 8;
      score += (cl.split(kw).length - 1);
    });
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  // 관련 페이지 없으면 제목에서 폭넓게 재탐색
  let relevant = scored.slice(0, 40);
  if (relevant.length < 3) {
    const fallback = pages.filter(p => {
      const tl = p.title.toLowerCase();
      return expandedKeywords.some(kw => tl.includes(kw));
    }).slice(0, 20);
    relevant = [...relevant, ...fallback.filter(f => !relevant.find(r => r.title === f.title))];
  }
  if (relevant.length === 0) relevant = pages.slice(0, 10);

  const filteredCtx = relevant.map((p, i) =>
    `=== [${p.title}] ===\n${i < 10 ? p.content : p.content.substring(0, 3000)}`
  ).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래 기획서 원문을 분석해서 질문에 정확하고 상세하게 답해.

[절대 규칙]
1. 질문과 직접 관련된 내용만 답해. 관련 없는 내용은 절대 포함 금지.
2. 기획서 원문의 수치, 공식, 조건, 예외사항을 빠짐없이 포함해.
3. 제목/서브제목 뒤 [[페이지명]] 출처 표시. 단, 같은 페이지는 처음 1번만 표시.
   예: ## 제목 [[페이지명]]  →  ### 소제목  →  - 내용 (소제목엔 [[]] 반복 금지)
4. [[페이지명]]은 반드시 ]]로 완전히 닫을 것. 불완전한 [[ 절대 금지.
5. [[]] 안의 페이지명은 반드시 아래 목록에 있는 실제 페이지명 그대로 사용.
6. 기획서에 관련 내용이 있으면 반드시 찾아서 답해. "찾을 수 없습니다"는 정말 없을 때만.
7. 한국어로, ## 대제목 [[출처]] / ### 소제목 / - 항목 / **수치** 구조.
8. 질문 범위를 벗어나는 내용 추가 금지.

[사용 가능한 페이지 목록 (이 이름 그대로만 사용)]
${relevant.map(p => '- ' + p.title).join('\n')}

[기획서 원문 - 관련 ${relevant.length}개 페이지]
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
