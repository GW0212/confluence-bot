import { rankPages } from './lib/search.js';

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
    let body = chunk.replace(/=== \[.+?\] ===\n?/, '').trim();
    // 방어적 정리: 과거 캐시에 남아있을 수 있는 CSS/HTML 속성 잔재 제거
    // (예: "[data-colorid=...]{color:#494949}", "html[data-theme]" 같은 CSS 셀렉터 텍스트)
    body = body
      .replace(/\[?data-[\w-]+=[^\]\s{]*\]?\s*\{[^}]*\}/gi, '')
      .replace(/\{color:#?[0-9a-fA-F]{3,6}\}/gi, '')
      .replace(/\b[\w-]+\[data-[\w-]+(?:=[^\]]*)?\]/gi, '') // html[data-theme] 같은 CSS 셀렉터 텍스트
      .replace(/&lt;|&gt;/g, '')
      .replace(/\s{2,}/g, ' ');
    pages.push({ title: m[1].trim(), content: body });
  }

  // 검색 모듈로 관련 페이지 정밀 랭킹
  const { relevant, exactMatches } = rankPages(question, pages);

  // exactMatches(제목 일치)는 전체 내용, 상위 12개는 전체, 나머지는 4000자 제한
  // exactMatches(버전/제목 일치)는 우선적으로 풍부한 내용을 포함하되,
  // exactMatches 수가 많을 때는 페이지당 상한을 둬서 전체 요청 크기가 과도해지지 않도록 함
  const exactCap = exactMatches.length > 15 ? 8000 : exactMatches.length > 8 ? 12000 : exactMatches.length > 4 ? 20000 : 100000;
  const filteredCtx = relevant.map((p, i) => {
    const isExact = exactMatches.find(em => em.title === p.title);
    const limit = isExact ? Math.min(p.content.length, exactCap) : (i < 12 ? p.content.length : 4000);
    return `=== [${p.title}] ===\n${p.content.substring(0, limit)}`;
  }).join('\n\n');

  const prompt = `너는 ArcheAge WAR 게임 기획서 전문 AI야. 아래 [기획서 원문]을 근거로 질문에 정확하고 상세하게 답해야 해.

[절대 규칙 - 반드시 준수]
1. [기획서 원문]에 있는 내용만 사실로 인정하고, 수치/공식/조건/예외사항을 빠짐없이 정리해서 답해.
2. 질문과 직접 관련된 내용만 포함하고, 관련 없는 내용은 절대 추가하지 마.
3. 제목/서브제목 뒤에 [[페이지명]] 형식으로 출처를 표시해. 단, 같은 페이지는 답변 내 처음 1번만 표시하고 이후 같은 페이지를 다시 인용할 때는 [[]] 표시를 생략해.
   예시: ## 경직 시스템 [[경직]]  /  ### 경직 시간  /  - 0.2초로 정의됨
4. [[페이지명]]은 반드시 ]]로 완전히 닫을 것. [[처럼 닫히지 않은 형태는 절대 사용 금지.
5. [[]] 안의 이름은 반드시 아래 [사용 가능한 페이지 목록]에 있는 실제 제목 그대로 사용해.
6. 매우 중요 - 여러 페이지 종합: 질문이 특정 패치/버전/주제를 가리키면(예: "M58", "전투 시스템"), [사용 가능한 페이지 목록]에서 그 패치/주제와 관련된 페이지가 여러 개 있을 수 있다. 한두 페이지만 보고 끝내지 말고, 목록에 있는 관련 페이지를 전부 [기획서 원문]에서 찾아 빠짐없이 종합해서 답해. 페이지가 다르면 섹션을 나눠서(## 또는 ### 사용) 각각 표시해.
7. 매우 중요 - 버전/패치 번호 매칭: 질문에 "M57.0", "M57", "m57" 같은 패치 번호가 있으면, 끝의 마이너 버전(.0, .1, .2 등) 차이는 무시하고 동일한 패치로 간주해. 예를 들어 "M57.0"으로 질문해도 제목이 "M57"인 페이지, "M57 패치"인 페이지, "M57.2"인 페이지 모두 같은 패치로 보고 관련 내용을 모두 찾아 답해. 이 규칙은 다른 영문+숫자 조합 식별자(Q7, v1.2 등)에도 동일하게 적용해.
8. 매우 중요: [사용 가능한 페이지 목록]에 질문 키워드와 제목이 일치하거나 유사한 페이지가 있다면, 그 페이지의 내용은 [기획서 원문]에 반드시 포함되어 있다. 어떤 경우에도 "찾을 수 없습니다"라고 답하지 말고, 원문을 끝까지 다시 살펴서 관련 문장을 찾아 답해.
9. [기획서 원문]을 전부 검토했는데도 정말로 질문과 관련된 내용이 한 글자도 없을 때만 "기획서 원문에서 관련 내용을 찾을 수 없습니다."라고 답해.
10. 반드시 한국어로 답하고, 구조는 ## 대제목 [[출처]] / ### 소제목 / - 항목 / **핵심 수치**로 정리해.
11. 질문의 범위를 벗어나는 부가 설명, 다른 페이지 요약 등은 추가하지 마.
12. 답변에 사용한 모든 수치, 조건, 예외사항은 [기획서 원문]에 실제로 적힌 표현을 그대로 반영해. 원문에 없는 추측이나 일반 게임 지식으로 채우지 마.
13. [기획서 원문]에 HTML 태그, CSS 속성(예: data-colorid=..., {color:#494949}), 빈 마크업 잔재가 섞여 있다면 그건 원문 변환 과정의 부산물이니 완전히 무시하고, 실제 의미 있는 텍스트 내용만 답변에 반영해.

[사용 가능한 페이지 목록 - 이 목록의 페이지는 모두 아래 원문에 포함되어 있음]
${relevant.map(p => '- ' + p.title).join('\n')}

[기획서 원문]
${filteredCtx}

[질문]
${question}

위 [기획서 원문]을 빠짐없이 검토한 뒤, 질문에 대해 가능한 가장 정확하고 상세한 답변을 작성해.`;

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
              generationConfig: { temperature: 0.0, maxOutputTokens: 8192 }
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
        const finishReason = data.candidates?.[0]?.finishReason;
        let cleaned = raw.replace(/\[\[(?![^\]]*\]\])[^\n]*/g, '');
        if (finishReason === 'MAX_TOKENS') {
          cleaned += '\n\n*(답변이 길어 일부가 잘렸어요. "계속 답변해줘"라고 다시 물어보시면 이어서 답해드릴게요.)*';
        }
        return res.json({
          success: true,
          answer: cleaned,
          model,
          matchedPages: relevant.slice(0, 10).map(p => p.title),
          totalPages: pages.length
        });
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
