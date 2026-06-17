export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { question, context } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.' });

  const pages = [];
  for (const chunk of context.split(/(?=\n?=== \[)/)) {
    const m = chunk.match(/=== \[(.+?)\] ===/);
    if (!m) continue;
    pages.push({ title: m[1].trim(), content: chunk.replace(/=== \[.+?\] ===\n?/, '').trim() });
  }

  function getPatchNumber(title) {
    const m = title.match(/[Mm](\d+)/);
    return m ? parseInt(m[1]) : 0;
  }

  const qLower = question.toLowerCase();
  const qKeywords = qLower.split(/[\s,./()[\]"'?!]+/).filter(w => w.length >= 2);

  const synonyms = {
    '전투': ['전투', '스킬', '경직', '공격', '방어', '밸런스'],
    '캐릭터': ['캐릭터', '직업', '속도', '능력치'],
    '콘텐츠': ['콘텐츠', '던전', '필드', '레이드', '보스'],
    '아이템': ['아이템', '장비', '소환', '소환사'],
  };
  let expandedKw = [...qKeywords];
  Object.keys(synonyms).forEach(key => {
    if (qLower.includes(key)) expandedKw = expandedKw.concat(synonyms[key]);
  });
  expandedKw = [...new Set(expandedKw)];

  const exactTitleMatches = pages.filter(p => {
    const tl = p.title.toLowerCase().trim();
    return qKeywords.some(kw => tl === kw);
  });

  const scored = pages.map(p => {
    const tl = p.title.toLowerCase();
    const cl = p.content.toLowerCase();
    let score = 0;
    expandedKw.forEach(kw => {
      if (tl === kw) score += 50;
      else if (tl.includes(kw)) score += 8;
      score += (cl.split(kw).length - 1);
    });
    const pn = getPatchNumber(p.title);
    if (pn > 0 && score > 0) score += pn * 0.1;
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  let relevant = scored.slice(0, 40);
  exactTitleMatches.forEach(em => {
    relevant = relevant.filter(r => r.title !== em.title);
    relevant.unshift({ ...em, score: 999 });
  });

  if (relevant.length < 3) {
    const fallback = pages.filter(p =>
      expandedKw.some(kw => p.title.toLowerCase().includes(kw))
    ).slice(0, 20);
    relevant = [...relevant, ...fallback.filter(f => !relevant.find(r => r.title === f.title))];
  }
  if (relevant.length === 0) relevant = pages.slice(0, 10);
  relevant = relevant.slice(0, 45);

  const filteredCtx = relevant.map((p, i) => {
    const isExact = exactTitleMatches.find(em => em.title === p.title);
    const limit = isExact ? p.content.length : (i < 10 ? p.content.length : 3000);
    return `=== [${p.title}] ===\n${p.content.substring(0, limit)}`;
  }).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래 기획서 원문을 분석해서 질문에 정확하고 상세하게 답해.

[절대 규칙]
1. 질문과 직접 관련된 내용만 답해. 관련 없는 내용은 절대 포함 금지.
2. 기획서 원문의 수치, 공식, 조건, 예외사항을 빠짐없이 포함해.
3. 제목/서브제목 뒤 [[페이지명]] 출처 표시. 단, 같은 페이지는 처음 1번만 표시.
4. [[페이지명]]은 반드시 ]]로 완전히 닫을 것. 불완전한 [[ 절대 금지.
5. [[]] 안의 페이지명은 반드시 아래 목록의 실제 페이지명 그대로 사용.
6. 기획서에 관련 내용이 있으면 반드시 찾아서 답해. "찾을 수 없습니다"는 정말 없을 때만.
7. 한국어로, ## 대제목 [[출처]] / ### 소제목 / - 항목 / **수치** 구조.
8. 질문 범위를 벗어나는 내용 추가 금지.

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
        const cleaned = raw.replace(/\[\[(?![^\]]*\]\])[^\n]*/g, '');
        return res.json({ success: true, answer: cleaned, model, matchedPages: relevant.slice(0,10).map(p=>p.title), totalPages: pages.length });
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
