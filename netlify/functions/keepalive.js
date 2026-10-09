/*
 * Netlify Scheduled Function —— 防止 Supabase 免费项目因 7 天无流量被自动暂停。
 * 每天 UTC 09:00 向 Supabase 发一个极轻的查询（select updated_at limit 1），
 * 维持「活跃」状态，避免项目被暂停导致 App 连不上云端。
 * 该函数在 Netlify 服务端运行，可直连 supabase.co（无需走代理）。
 */

const SUPABASE_URL = 'https://wkjbojpazpqajiqmgonn.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndramJvanBhenBxYWppcW1nb25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwOTUzNjgsImV4cCI6MjA3ODY3MTM2OH0.7syQZWKVkkI48v_bS2jQE9jzBqCfVnJmliHxDOwDnNw'; // 与 app.js 相同的 anon public key
const TARGET = SUPABASE_URL + '/rest/v1/homework?select=updated_at&limit=1';

exports.handler = async function (event, context) {
  try {
    const res = await fetch(TARGET, {
      headers: {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + SB_KEY,
        Accept: 'application/json'
      }
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, status: res.status }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
