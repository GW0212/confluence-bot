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
    pages.push({ title: m[1].trim(), content: chunk.replace(/=== \[.+?\] ===\n?/, '').trim() });
  }

  function getPatchNumber(title) {
    const m = title.match(/[Mm](\d+)/);
    return m ? parseInt(m[1]) : 0;
  }

  // 질문에서 핵심 명사구 추출 (조사/어미 제거)
  function cleanQuestion(q) {
    return q
      .replace(/(시스템|기획|내용|설명해|알려줘|줘|이|가|는|을|를|에|뭐야|뭔가요|란|이란|에 대해|에대해|관련|해줘|\?|！|!)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const qLower = question.toLowerCase();
  const qCleaned = cleanQuestion(question).toLowerCase();
  const qKeywords = qLower.split(/[\s,./()[\]"'?!]+/).filter(w => w.length >= 2);
  const qCleanedKeywords = qCleaned.split(/\s+/).filter(w => w.length >= 2);

  const synonyms = {
    '전투': ['전투', '스킬', '경직', '공격', '방어', '밸런스'],
    '캐릭터': ['캐릭터', '직업', '속도', '능력치'],
    '콘텐츠': ['콘텐츠', '던전', '필드', '레이드', '보스'],
    '아이템': ['아이템', '장비', '소환', '소환사'],
  };
  let expandedKw = [...qKeywords, ...qCleanedKeywords];
  Object.keys(synonyms).forEach(key => {
    if (qLower.includes(key)) expandedKw = expandedKw.concat(synonyms[key]);
  });
  expandedKw = [...new Set(expandedKw)];

  // 제목 완전/부분 일치 페이지 탐지 (핵심 키워드 기준)
  const exactTitleMatches = pages.filter(p => {
    const tl = p.title.toLowerCase().trim();
    // 정제된 질문 전체가 제목과 일치하거나, 제목이 정제된 질문에 포함되거나, 핵심 키워드가 제목과 정확히 일치
    if (tl === qCleaned) return true;
    if (qCleaned.includes(tl) && tl.length >= 2) return true;
    if (qCleanedKeywords.some(kw => tl === kw)) return true;
    return false;
  });

  const scored = pages.map(p => {
    const tl = p.title.toLowerCase();
    const cl = p.content.toLowerCase();
    let score = 0;
    expandedKw.forEach(kw => {
      if (tl === kw) score += 50;
      else if (tl.includes(kw)) score += 10;
      score += (cl.split(kw).length - 1) * 1.5;
    });
    const pn = getPatchNumber(p.title);
    if (pn > 0 && score > 0) score += pn * 0.1;
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);

  let relevant = scored.slice(0, 40);

  // 제목 일치 페이지는 무조건 최우선 포함
  exactTitleMatches.forEach(em => {
    relevant = relevant.filter(r => r.title !== em.title);
    relevant.unshift({ ...em, score: 999 });
  });

  if (relevant.length < 5) {
    const fallback = pages.filter(p =>
      expandedKw.some(kw => p.title.toLowerCase().includes(kw))
    ).slice(0, 25);
    relevant = [...relevant, ...fallback.filter(f => !relevant.find(r => r.title === f.title))];
  }
  if (relevant.length === 0) relevant = pages.slice(0, 15);

  relevant = relevant.slice(0, 45);

  const filteredCtx = relevant.map((p, i) => {
    const isExact = exactTitleMatches.find(em => em.title === p.title);
    const limit = isExact ? p.content.length : (i < 12 ? p.content.length : 3000);
    return `=== [${p.title}] ===\n${p.content.substring(0, limit)}`;
  }).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야.
아래 기획서 원문을 분석해서 질문에 정확하고 상세하게 답해.

[절대 규칙]
1. 질문과 직접 관련된 내용만 답해. 관련 없는 내용은 절대 포함 금지.
2. 기획서 원문의 수치, 공식, 조건, 예외사항을 빠짐없이 포함해.
3. 제목/서브제목 뒤 [[페이지명]] 출처 표시. 단, 같은 페이지는 처음 1번만 표시.
   예: ## 제목 [[페이지명]]  →  ### 소제목  →  - 내용 (소제목엔 [[]] 반복 금지)
4. [[페이지명]]은 반드시 ]]로 완전히 닫을 것. 불완전한 [[ 절대 금지.
5. [[]] 안의 페이지명은 반드시 아래 목록의 실제 페이지명 그대로 사용.
6. 아래 [사용 가능한 페이지 목록]에 질문 키워드와 일치하거나 유사한 제목의 페이지가 있다면, 그 페이지는 반드시 [기획서 원문]에 포함되어 있으니 내용을 찾아서 답해. "찾을 수 없습니다"라고 절대 답하지 마.
7. 기획서 원문 전체를 다시 한번 확인한 후, 정말로 관련 내용이 전혀 없을 때만 "기획서에서 찾을 수 없습니다"라고 해.
8. 한국어로, ## 대제목 [[출처]] / ### 소제목 / - 항목 / **수치** 구조로 답해.
9. 질문 범위를 벗어나는 내용 추가 금지.

[사용 가능한 페이지 목록 - 이 중 질문과 관련된 페이지의 내용은 반드시 아래 원문에 있음]
${relevant.map(p => '- ' + p.title).join('\n')}

[기획서 원문]
${filteredCtx}

[질문]
${question}

위 [기획서 원문]을 빠짐없이 검토한 후 답해. 질문과 일치하는 페이지 제목이 [사용 가능한 페이지 목록]에 있다면 그 내용은 분명히 [기획서 원문]에 존재하니 찾아서 답할 것.`;

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
        return res.json({ success: true, answer: cleaned, model, matchedPages: relevant.length });
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
