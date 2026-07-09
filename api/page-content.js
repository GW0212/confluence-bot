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

    let h = rawHtml;

    // 1) 불필요한 블록 통째로 제거
    h = h.replace(/<style[\s\S]*?<\/style>/gi, '');
    h = h.replace(/<script[\s\S]*?<\/script>/gi, '');
    h = h.replace(/<ac:parameter[\s\S]*?<\/ac:parameter>/gi, '');
    h = h.replace(/<ac:plain-text-body>[\s\S]*?<\/ac:plain-text-body>/gi, '');
    h = h.replace(/<div[^>]*page-metadata[^>]*>[\s\S]*?<\/div>/gi, '');
    h = h.replace(/<div[^>]*recently-updated[^>]*>[\s\S]*?<\/div>/gi, '');

    // 2) ★ 핵심: li 안의 p 태그 언래핑 (서버에서 정규식으로 처리)
    // <li><p>내용</p></li> → <li>내용</li>  (줄바꿈 버그의 근본 원인)
    // 반복적으로 적용해서 중첩된 경우도 처리
    for (let i = 0; i < 5; i++) {
      const before = h;
      h = h.replace(/<li([^>]*)>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/li>/gi, '<li$1>$2</li>');
      h = h.replace(/<li([^>]*)>\s*<p[^>]*>([\s\S]*?)<\/p>/gi, '<li$1>$2');
      if (h === before) break;
    }

    // 3) 모든 속성 제거 (style, class, data-* 등)
    h = h.replace(/\s+style="[^"]*"/gi, '');
    h = h.replace(/\s+style='[^']*'/gi, '');
    h = h.replace(/\s+class="[^"]*"/gi, '');
    h = h.replace(/\s+class='[^']*'/gi, '');
    h = h.replace(/\s+data-[\w-]+="[^"]*"/gi, '');
    h = h.replace(/\s+data-[\w-]+='[^']*'/gi, '');
    h = h.replace(/\s+id="[^"]*"/gi, '');

    // 4) li 사이 빈 p 태그 제거
    h = h.replace(/<\/li>\s*<p[^>]*>\s*<\/p>\s*<li/gi, '</li><li');
    h = h.replace(/<p[^>]*>\s*(&nbsp;|\s)*<\/p>/gi, '');
    h = h.replace(/<p[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, '');

    // 5) MSO CSS 텍스트 잔재 제거
    h = h.replace(/mso-[\w-]+:[^;}"'<]{1,200};/g, '');
    h = h.replace(/\[?data-[\w-]+=[^\]\s{]*\]?\s*\{[^}]*\}/gi, '');

    // 6) 변경이력 문장 제거
    h = h.replace(/\S+\.(xlsx|docx|pptx|pdf|hwp|zip|csv|png|jpg)\s+파일[이이]?\s+\S+에\s+의해\s+변경되었습니다\.?/gi, '');

    const cleanHtml = h;

    // 텍스트 content 생성
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
      .replace(/&lt;/g, '').replace(/&gt;/g, '')
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
