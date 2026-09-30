/*
 * Netlify Function —— Supabase 同域中转代理
 *
 * 问题：国内手机网络直连 supabase.co（AWS/Cloudflare 托管）经常被墙 / 超时，
 *       导致前端 fetch 直接失败，报“网络不通 / 跨域”。
 * 解决：手机只连 Netlify（应用本身就在 Netlify 上，必然可达），
 *       由这个服务端函数去连 Supabase 再把结果原样返回。
 *       这样既绕开了墙，又天然同域、无需再处理 CORS。
 *
 * 安全：只放行本项目 Supabase 地址（防被当成开放代理 / SSRF）。
 */

const SUPABASE_URL = 'https://wkjbojpazpqajiqmgonn.supabase.co';
// 只转发必要的请求头，避免泄露或注入多余头
const ALLOWED_REQ_HEADERS = ['apikey', 'authorization', 'content-type', 'accept', 'prefer'];
// 回传时保留对前端解析有用的响应头
const ALLOWED_RES_HEADERS = ['content-type', 'content-range', 'content-location'];

exports.handler = async function (event, context) {
  try {
    const params = event.queryStringParameters || {};
    const target = params.u; // 前端把完整 Supabase 路径编码后放这里
    if (!target || !target.startsWith(SUPABASE_URL + '/')) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'invalid or disallowed target' })
      };
    }

    const srcHeaders = event.headers || {};
    const fwdHeaders = {};
    for (const key of ALLOWED_REQ_HEADERS) {
      const v = srcHeaders[key] || srcHeaders[key.toLowerCase()];
      if (v) fwdHeaders[key] = v;
    }

    const init = { method: event.httpMethod, headers: fwdHeaders };
    if (event.body && event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
      init.body = event.body;
    }

    const res = await fetch(target, init);
    const buf = await res.arrayBuffer();

    const outHeaders = {};
    for (const key of ALLOWED_RES_HEADERS) {
      const v = res.headers.get(key);
      if (v) outHeaders[key] = v;
    }

    return {
      statusCode: res.status,
      headers: outHeaders,
      body: Buffer.from(buf).toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'proxy failed: ' + (e && e.message ? e.message : String(e)) })
    };
  }
};
