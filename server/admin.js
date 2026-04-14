// Admin auth: ADMIN_TOKEN header OR localhost request always allowed.

export function isAdmin(req) {
  const token = process.env.ADMIN_TOKEN;
  const provided = req.headers['x-admin-token'];
  if (token && provided && provided === token) return true;

  const ra = req.socket?.remoteAddress || '';
  // 127.0.0.1, ::1, ::ffff:127.0.0.1
  if (ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1') return true;

  return false;
}
