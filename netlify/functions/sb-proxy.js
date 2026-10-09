/*
 * Netlify Function —— Supabase 中转代理（支持跨域）
 *
 * 问题：国内网络直连 supabase.co（AWS/Cloudflare 托管）经常被墙 / 超时，
 *       导致前端 fetch 直接失败，报“网络不通 / 跨域”。
 * 解决：由这个服务端函数去连 Supabase 再把结果原样返回。
 *       应用可能部署在任意域名（netlify.app / app.workbuddy.link / 自定义域名），
 *       前端用「绝对地址」跨域调用本函数，因此这里必须放行 CORS。
 *
 * 安全：只放行本项目 Supabase 地址（防被当成开放代理 / SSRF）。
 */

const SUPABASE_URL = 'https://wkjbojpazpqajiqmgonn.supabase.co';

// 跨域放行：前端会从 app.workbuddy.link 等其它域名调用本函数
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, accept, prefer'
};

// 只转发必要的请求头，避免泄露或注入多余头
const ALLOWED_REQ_HEADERS = ['apikey', 'authorization', 'content-type', 'accept', 'prefer'];
// 回传时保留对前端解析有用的响应头
const ALLOWED_RES_HEADERS = ['content-type', 'content-range', 'content-location'];

function withCors(extra) {
  var h = {};
  for (var k in CORS) h[k] = CORS[k];
  if (extra) for (var j in extra) h[j] = extra[j];
  return h;
}

exports.handler = async function (event, context) {
  // 浏览器对带自定义头（apikey/authorization）的跨域请求会先发 OPTIONS 预检，必须放行
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: withCors() };
  }
  try {
    const params = event.queryStringParameters || {};
    const target = params.u; // 前端把完整 Supabase 路径编码后放这里
    if (!target || !target.startsWith(SUPABASE_URL + '/')) {
      return {
        statusCode: 400,
        headers: withCors({ 'content-type': 'application/json' }),
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
      headers: withCors(outHeaders),
      body: Buffer.from(buf).toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: withCors({ 'content-type': 'application/json' }),
      body: JSON.stringify({ error: 'proxy failed: ' + (e && e.message ? e.message : String(e)) })
    };
  }
};
