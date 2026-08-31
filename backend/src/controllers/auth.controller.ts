import { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { env } from '../config/env.js';

const loginSchema = z.object({
  username: z.string().min(1, 'Username wajib diisi'),
  password: z.string().min(1, 'Password wajib diisi'),
});

export class AuthController {
  public static login(req: Request, res: Response): void {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || 'Input login tidak valid.',
      });
      return;
    }

    const { username, password } = parsed.data;
    const user = authService.authenticate(username, password);

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Username atau kata sandi salah. Akses ditolak.',
      });
      return;
    }

    const token = authService.generateToken(user);

    res.status(200).json({
      success: true,
      message: 'Login berhasil.',
      token,
      user: {
        username: user.username,
        role: user.role,
        displayName: user.displayName,
      },
    });
  }

  public static me(req: AuthenticatedRequest, res: Response): void {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    res.status(200).json({
      success: true,
      user: {
        username: req.user.sub,
        role: req.user.role,
        displayName: 'Administrator Hydra',
      },
    });
  }

  public static logout(_req: Request, res: Response): void {
    res.status(200).json({
      success: true,
      message: 'Logout berhasil.',
    });
  }
}
