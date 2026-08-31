import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';

export interface AuthUser {
  username: string;
  role: 'admin';
  displayName: string;
}

export interface TokenPayload {
  sub: string;
  role: 'admin';
  iat: number;
  exp: number;
}

export class AuthService {
  private secret: string;
  private readonly tokenDurationMs = 7 * 24 * 60 * 60 * 1000; // 7 hari

  constructor() {
    this.secret = env.AUTH_SECRET;
  }

  /**
   * Memvalidasi kredensial login admin menggunakan perbandingan konstan-waktu (timing-safe).
   */
  public authenticate(username: string, password: string): AuthUser | null {
    if (!username || !password) return null;

    const expectedUser = env.ADMIN_USERNAME;
    const expectedPass = env.ADMIN_PASSWORD;

    const userMatch = this.safeCompare(username, expectedUser);
    const passMatch = this.safeCompare(password, expectedPass);

    if (userMatch && passMatch) {
      logger.info(`[AUTH] Admin login successful for user: "${username}"`);
      return {
        username: expectedUser,
        role: 'admin',
        displayName: 'Administrator Hydra',
      };
    }

    logger.warn(`[AUTH] Failed login attempt with username: "${username}"`);
    return null;
  }

  /**
   * Menghasilkan token JWT bertanda tangan HMAC-SHA256 (tanpa dependensi eksternal).
   */
  public generateToken(user: AuthUser): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Date.now();
    const payload: TokenPayload = {
      sub: user.username,
      role: user.role,
      iat: Math.floor(now / 1000),
      exp: Math.floor((now + this.tokenDurationMs) / 1000),
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Memverifikasi token JWT dan mengembalikan payload jika valid.
   */
  public verifyToken(token: string): TokenPayload | null {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;

    // Verifikasi signature
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    if (!this.safeCompare(signature, expectedSignature)) {
      return null;
    }

    try {
      const payload: TokenPayload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8')
      );

      // Periksa masa berlaku token
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < nowSec) {
        logger.warn(`[AUTH] Token expired for sub: ${payload.sub}`);
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Perbandingan string konstan-waktu untuk mencegah timing attack.
   */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }
}

export const authService = new AuthService();
