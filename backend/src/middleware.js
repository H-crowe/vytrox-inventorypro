import jwt from 'jsonwebtoken';
import { httpError } from './validators.js';

const permissions = {
  admin: ['*'],
  inventory_manager: ['read', 'write_inventory', 'purchase'],
  cashier: ['read', 'sale']
};

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function auth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(httpError('Authentication required.', 401));

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch {
    next(httpError('Invalid or expired token.', 401));
  }
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    const allowed = permissions[req.user.role] || [];
    if (allowed.includes('*') || allowed.includes(permission)) return next();
    next(httpError('You do not have permission for this action.', 403));
  };
}

export function notFound(req, _res, next) {
  next(httpError(`Route not found: ${req.method} ${req.path}`, 404));
}

export function errorHandler(error, _req, res, _next) {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ message: status >= 500 ? 'Internal server error.' : error.message });
}
