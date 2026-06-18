export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token, baseUrl, pageId } = req.body;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    const url = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.view,title,space`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });

    if (!response.ok) return res.status(response.status).json({ error: '페이지 로드 실패' });

    const data = await response.json();
    const rawHtml = data.body?.view?.value || '';

    let text = rawHtml;

    // 1) 스크립트/스타일/매크로 블록 등 텍스트로 변환할 가치 없는 영역을 통째로 제거
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      // Confluence 매크로 파라미터 정의 블록 (ac:parameter 등)에 남는 CSS 유사 텍스트 제거
      .replace(/<ac:parameter[\s\S]*?<\/ac:parameter>/gi, '')
      .replace(/<ac:plain-text-body>[\s\S]*?<\/ac:plain-text-body>/gi, '')
      // data-colorid, style="..." 같은 속성에 직접 들어간 CSS 잔재가
      // 태그 제거 후 텍스트로 남지 않도록, 속성 자체를 태그 제거 전에 정리
      .replace(/\s(style|data-[\w-]+)="[^"]*"/gi, '')
      .replace(/\s(style|data-[\w-]+)='[^']*'/gi, '');

    // 2) 줄바꿈이 되어야 할 구조적 태그를 개행으로 변환
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/div>/gi, '\n');

    // 3) 남은 모든 HTML 태그 제거 (속성은 이미 위에서 정리됐으므로 안전)
    text = text.replace(/<[^>]+>/g, '');

    // 4) HTML 엔티티 디코딩은 태그 제거가 끝난 "이후"에 수행
    //    (태그 제거 전에 디코딩하면 &lt;div&gt; 같은 안전한 이스케이프 텍스트가
    //     실제 태그처럼 되살아나 다시 노출되는 문제가 있었음 — 순서가 핵심)
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '')   // 디코딩된 부등호가 다시 태그처럼 보이는 걸 막기 위해 제거(복원 대신 삭제)
      .replace(/&gt;/g, '');

    // 5) 공백/개행 정리
    text = text
      .replace(/\t/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Confluence 페이지 직접 URL
    const pageUrl = `${baseUrl}/wiki/spaces/${data.space?.key || ''}/pages/${pageId}`;

    res.json({ success: true, title: data.title, content: text, html: rawHtml, pageUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
