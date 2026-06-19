import { rankPages } from './lib/search.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 핸들러 전체를 try/catch로 감싸서, 어떤 단계에서 예외가 나도
  // 절대 비정형 500 에러(HTML)가 아니라 항상 JSON으로 응답하도록 보장한다.
  try {
    const { question, context } = req.body || {};
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: '질문이 비어있어요.' });
    }
    if (!context || typeof context !== 'string') {
      return res.status(400).json({ error: '기획서 내용이 비어있어요. 페이지를 새로고침해주세요.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았어요.' });

    // ── 1) 페이지 파싱 (개별 청크 파싱 실패가 전체를 죽이지 않도록 try/catch) ──
    const pages = [];
    try {
      for (const chunk of context.split(/(?=\n?=== \[)/)) {
        try {
          const m = chunk.match(/=== \[(.+?)\] ===/);
          if (!m) continue;
          let body = chunk.replace(/=== \[.+?\] ===\n?/, '').trim();
          body = body
            .replace(/\[?data-[\w-]+=[^\]\s{]*\]?\s*\{[^}]*\}/gi, '')
            .replace(/\{color:#?[0-9a-fA-F]{3,6}\}/gi, '')
            .replace(/\b[\w-]+\[data-[\w-]+(?:=[^\]]*)?\]/gi, '')
            .replace(/&lt;|&gt;/g, '')
            .replace(/\s{2,}/g, ' ');
          pages.push({ title: m[1].trim(), content: body });
        } catch (chunkErr) {
          // 페이지 하나 파싱이 실패해도 나머지는 계속 처리
          continue;
        }
      }
    } catch (parseErr) {
      return res.status(500).json({ error: '기획서 내용을 처리하는 중 오류가 발생했어요. 페이지를 새로고침 후 다시 시도해주세요.' });
    }

    if (pages.length === 0) {
      return res.status(400).json({ error: '읽을 수 있는 기획서 페이지가 없어요. 페이지를 새로고침해주세요.' });
    }

    // ── 2) 검색/랭킹 (실패해도 전체 페이지로 폴백) ──
    let relevant = [];
    let exactMatches = [];
    try {
      const result = rankPages(question, pages);
      relevant = result.relevant || [];
      exactMatches = result.exactMatches || [];
    } catch (rankErr) {
      // 검색 모듈에서 예외가 나도 답변 자체는 시도할 수 있도록 전체 페이지로 폴백
      relevant = pages.slice(0, 30);
      exactMatches = [];
    }
    if (relevant.length === 0) relevant = pages.slice(0, 15);

    // exactMatches(버전/제목 일치) 페이지는 우선적으로 풍부한 내용을 포함하되,
    // 전체 프롬프트가 너무 커지면 Gemini 응답 생성 자체가 30초(Vercel 한도)를 넘겨
    // FUNCTION_INVOCATION_TIMEOUT이 발생하므로, "용량(4.5MB)"이 아니라 "처리 시간"을 기준으로
    // 훨씬 더 보수적으로 1페이지당 글자 수를 제한한다.
    const exactCap =
      exactMatches.length > 20 ? 1200 :
      exactMatches.length > 12 ? 1800 :
      exactMatches.length > 8  ? 2500 :
      exactMatches.length > 4  ? 4000 : 6000;
    const generalCap = 1500; // exactMatches가 아닌 일반 참고 페이지는 짧게만 포함
    const filteredCtx = relevant.map((p, i) => {
      const isExact = exactMatches.find(em => em.title === p.title);
      const safeContent = typeof p.content === 'string' ? p.content : '';
      const limit = isExact ? Math.min(safeContent.length, exactCap) : Math.min(safeContent.length, generalCap);
      return `=== [${p.title}] ===\n${safeContent.substring(0, limit)}`;
    }).join('\n\n');

    // 전체 프롬프트가 그래도 너무 크면(약 6만자 이상) 페이지 수 자체를 줄여서 재구성
    // (한 페이지씩 줄이는 것보다, 점수가 낮은 페이지부터 제외하는 게 응답 품질에 유리)
    let finalRelevant = relevant;
    let finalCtx = filteredCtx;
    const HARD_CHAR_LIMIT = 60000;
    if (finalCtx.length > HARD_CHAR_LIMIT) {
      let acc = [];
      let used = 0;
      for (const p of relevant) {
        const isExact = exactMatches.find(em => em.title === p.title);
        const safeContent = typeof p.content === 'string' ? p.content : '';
        const limit = isExact ? Math.min(safeContent.length, exactCap) : Math.min(safeContent.length, generalCap);
        const piece = `=== [${p.title}] ===\n${safeContent.substring(0, limit)}`;
        if (used + piece.length > HARD_CHAR_LIMIT && acc.length > 0) {
          // exactMatches는 가능한 끝까지 우선 포함하고, 일반 페이지부터 자른다
          if (!isExact) continue;
        }
        acc.push(p);
        used += piece.length;
      }
      finalRelevant = acc.length > 0 ? acc : relevant.slice(0, 10);
      finalCtx = finalRelevant.map((p, i) => {
        const isExact = exactMatches.find(em => em.title === p.title);
        const safeContent = typeof p.content === 'string' ? p.content : '';
        const limit = isExact ? Math.min(safeContent.length, exactCap) : Math.min(safeContent.length, generalCap);
        return `=== [${p.title}] ===\n${safeContent.substring(0, limit)}`;
      }).join('\n\n');
    }

    const prompt = `너는 Confluence 문서 기반 질의응답 전문 AI야. 아래 [기획서 원문]을 근거로 질문에 정확하고 상세하게 답해야 해.

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
${finalRelevant.map(p => '- ' + p.title).join('\n')}

[기획서 원문]
${finalCtx}

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
    let lastErrorDetail = '';

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

          let data;
          try {
            data = await response.json();
          } catch (jsonErr) {
            lastErrorDetail = `${model}: 응답이 JSON이 아님 (status ${response.status})`;
            if (attempt === 0) { await sleep(1000); continue; }
            break;
          }

          if (data.error) {
            lastErrorDetail = `${model}: ${data.error.message || data.error.status || '알 수 없는 오류'}`;
            if (data.error.code === 429 || data.error.status === 'RESOURCE_EXHAUSTED') {
              if (attempt === 0) { await sleep(2500); continue; }
              break;
            }
            // 모델별 오류(404 등)는 다음 모델로 즉시 넘어감
            break;
          }

          const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!raw) {
            lastErrorDetail = `${model}: 응답에 텍스트 없음 (finishReason: ${data.candidates?.[0]?.finishReason || 'unknown'})`;
            break;
          }

          const finishReason = data.candidates?.[0]?.finishReason;
          let cleaned = raw.replace(/\[\[(?![^\]]*\]\])[^\n]*/g, '');
          if (finishReason === 'MAX_TOKENS') {
            cleaned += '\n\n*(답변이 길어 일부가 잘렸어요. "계속 답변해줘"라고 다시 물어보시면 이어서 답해드릴게요.)*';
          }

          return res.json({
            success: true,
            answer: cleaned,
            model,
            matchedPages: finalRelevant.slice(0, 10).map(p => p.title),
            totalPages: pages.length
          });
        } catch (fetchErr) {
          lastErrorDetail = `${model}: ${fetchErr.message || '네트워크 오류'}`;
          if (attempt === 1) break;
          await sleep(1000);
        }
      }
    }

    // 모든 모델/재시도가 실패한 경우에도 항상 유효한 JSON으로 응답
    return res.status(503).json({
      error: '일시적으로 답변을 생성하지 못했어요. 잠시 후 다시 시도해주세요.' + (lastErrorDetail ? ` (${lastErrorDetail})` : '')
    });

  } catch (fatalErr) {
    // 위에서 예상하지 못한 어떤 예외가 나더라도 마지막 안전망으로 항상 JSON 응답
    return res.status(500).json({
      error: '서버 처리 중 예기치 않은 오류가 발생했어요: ' + (fatalErr.message || String(fatalErr))
    });
  }
}
