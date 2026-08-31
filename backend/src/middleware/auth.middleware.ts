import { Request, Response, NextFunction } from 'express';
import { authService, TokenPayload } from '../services/auth.service.js';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);

  if (!authHeader) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Header Authorization tidak ditemukan.',
    });
    return;
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : authHeader.trim();

  const payload = authService.verifyToken(token);

  if (!payload) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Token autentikasi tidak valid atau telah kedaluwarsa.',
    });
    return;
  }

  req.user = payload;
  next();
}
