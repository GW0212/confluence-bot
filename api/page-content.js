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

    // ── HTML 정제 (서버에서 미리 처리해서 클라이언트 부담 감소) ──
    let cleanHtml = rawHtml
      // 스크립트/스타일 블록 제거
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      // Confluence 매크로 파라미터 제거
      .replace(/<ac:parameter[\s\S]*?<\/ac:parameter>/gi, '')
      .replace(/<ac:plain-text-body>[\s\S]*?<\/ac:plain-text-body>/gi, '')
      // 변경이력/메타데이터 블록 통째로 제거
      .replace(/<div[^>]*page-metadata[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*recently-updated[^>]*>[\s\S]*?<\/div>/gi, '')
      // ★ 모든 요소의 style 속성 제거 (줄바꿈 버그 핵심 원인)
      .replace(/\s+style="[^"]*"/gi, '')
      .replace(/\s+style='[^']*'/gi, '')
      // data-* 속성 제거
      .replace(/\s+data-[\w-]+="[^"]*"/gi, '')
      .replace(/\s+data-[\w-]+='[^']*'/gi, '')
      // class 속성 제거 (Confluence 자체 CSS가 있으면 충돌하므로)
      .replace(/\s+class="[^"]*"/gi, '')
      .replace(/\s+class='[^']*'/gi, '')
      // CSS 아티팩트 텍스트 제거
      .replace(/\[?data-[\w-]+=[^\]\s{]*\]?\s*\{[^}]*\}/gi, '')
      .replace(/\{color:#?[0-9a-fA-F]{3,6}\}/gi, '')
      .replace(/\b[\w-]+\[data-[\w-]+(?:=[^\]]*)?\]/gi, '')
      // 변경이력 문장 제거
      .replace(/\S+\.(xlsx|docx|pptx|pdf|hwp|zip|csv|png|jpg)\s+파일[이이]?\s+\S+에\s+의해\s+변경되었습니다\.?/gi, '');

    // 텍스트용 content 생성
    let text = cleanHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '')
      .replace(/&gt;/g, '')
      .replace(/\t/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const pageUrl = `${baseUrl}/wiki/spaces/${data.space?.key || ''}/pages/${pageId}`;
    res.json({ success: true, title: data.title, content: text, html: cleanHtml, pageUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
