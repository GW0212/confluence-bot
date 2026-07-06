export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url: fileUrl, email, token, filename } = req.query;
  if (!fileUrl || !email || !token) {
    return res.status(400).send('필수 파라미터 누락');
  }

  try {
    const auth = Buffer.from(
      `${decodeURIComponent(email)}:${decodeURIComponent(token)}`
    ).toString('base64');

    const response = await fetch(decodeURIComponent(fileUrl), {
      headers: { 'Authorization': `Basic ${auth}` }
    });

    if (!response.ok) {
      return res.status(response.status).send('파일 로드 실패 (' + response.status + ')');
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = await response.arrayBuffer();
    const fname = filename ? decodeURIComponent(filename) : 'download';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.setHeader('Content-Length', buffer.byteLength);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).send(e.message);
  }
}
