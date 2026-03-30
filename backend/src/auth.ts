import express, { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  hasAdminUser,
  createUser,
  getUserByEmail,
  getUserByResetToken,
  updateUserPassword,
  setUserResetToken,
  getSetting,
  setSetting,
  getUserById
} from './db';
import { sendEmail } from './notifications';

export const authRouter = express.Router();

function getJwtSecret(): string {
  let secret = process.env.JWT_SECRET || getSetting('jwt_secret');
  if (!secret) {
    secret = crypto.randomBytes(64).toString('hex');
    setSetting('jwt_secret', secret);
    console.log('[Auth] Generated new JWT secret');
  }
  return secret;
}

// Check if setup is already complete
authRouter.get('/setup-status', (req, res) => {
  res.json({ isSetup: hasAdminUser() });
});

// Setup first admin user
authRouter.post('/setup', async (req, res) => {
  if (hasAdminUser()) {
    res.status(403).json({ error: 'El sistema ya ha sido configurado.' });
    return;
  }

  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    res.status(400).json({ error: 'Mínimo 6 caracteres para la contraseña y un correo válido.' });
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    createUser(email, hash);
    res.json({ ok: true, message: 'Usuario creado exitosamente.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Error al crear el usuario.', details: err.message });
  }
});

// Login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Correo y contraseña son requeridos.' });
    return;
  }

  const user = getUserByEmail(email);
  if (!user) {
    res.status(401).json({ error: 'Credenciales inválidas.' });
    return;
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    res.status(401).json({ error: 'Credenciales inválidas.' });
    return;
  }

  const token = jwt.sign({ id: user.id, email: user.email }, getJwtSecret(), { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email } });
});

// Forgot Password
authRouter.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const origin = req.headers.origin || process.env.PUBLIC_URL || 'http://localhost:5173'; // Default to origin

  if (!email) {
    res.status(400).json({ error: 'El correo es requerido.' });
    return;
  }

  const user = getUserByEmail(email);
  if (!user) {
    // Return OK even if user doesn't exist to prevent enum attacks
    res.json({ ok: true, message: 'Si el correo existe, se ha enviado un enlace.' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 1000 * 60 * 60; // 1 hour
  setUserResetToken(user.id, token, expires);

  const resetLink = `${origin}/reset-password?token=${token}`;
  const html = `
    <div style="font-family: sans-serif; padding: 20px;">
      <h2>Restablecimiento de Contraseña</h2>
      <p>Has solicitado restablecer tu contraseña en <strong>Mira</strong>.</p>
      <p>Haz clic en el siguiente enlace para continuar. Este enlace expira en 1 hora.</p>
      <a href="${resetLink}" style="display:inline-block; padding: 10px 15px; background: #77dd6d; color: #121416; text-decoration: none; font-weight: bold; border-radius: 5px;">Restablecer Contraseña</a>
      <p style="color:#888; font-size:12px; margin-top:20px;">Si no solicitaste esto, ignora este correo.</p>
    </div>
  `;

  const sent = await sendEmail('Restablecimiento de Contraseña - Mira', html, user.email);
  if (!sent) {
    console.error('[Auth] Could not send reset email. Ensure Resend or SMTP is configured.');
    // Keep it silent to the frontend mostly, or maybe let them know?
  }

  res.json({ ok: true, message: 'Si el correo existe, se ha enviado un enlace.' });
});

// Reset Password
authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 6) {
    res.status(400).json({ error: 'Se requiere un token y una contraseña válida (mín. 6 caracteres).' });
    return;
  }

  const user = getUserByResetToken(token);
  if (!user) {
    res.status(400).json({ error: 'Token inválido o expirado.' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  updateUserPassword(user.id, hash);
  res.json({ ok: true, message: 'Contraseña actualizada correctamente.' });
});

// Middleware for protecting routes
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'No se proveyó un token de autenticación.' });
    return;
  }

  jwt.verify(token, getJwtSecret(), (err: any, decoded: any) => {
    if (err) {
      res.status(403).json({ error: 'Token de autenticación inválido o expirado.' });
      return;
    }
    
    // Attach user to req (optional)
    (req as any).user = decoded;
    next();
  });
}

// Utility to verify token string synchronously for WebSockets
export function verifyTokenSync(token: string): any {
  return jwt.verify(token, getJwtSecret());
}
