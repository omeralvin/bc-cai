import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'cai_attendance_secret_token_key_2026_rfid';

export interface TokenPayload {
  userId: string;
  username: string;
  role: string;
  name: string;
}

export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });
};

export const verifyToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    return null;
  }
};
