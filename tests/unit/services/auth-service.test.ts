
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authService } from '@/services/auth/auth-service';
import { ValidationError } from '@/lib/logging/errors';

// Mock the auth library
const mockSignUpEmail = vi.fn();
const mockAllowed = vi.fn();
const { adapter, password } = vi.hoisted(() => ({
  adapter: {
    findUserById: vi.fn(),
    findAccounts: vi.fn(),
    updatePassword: vi.fn(),
    createAccount: vi.fn(),
  },
  password: { hash: vi.fn(async (value: string) => `hash:${value}`), verify: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      signUpEmail: (...args: any[]) => mockSignUpEmail(...args),
    },
    $context: Promise.resolve({ internalAdapter: adapter, password }),
  },
}));
vi.mock('@/services/auth/password-policy-service', () => ({
  assertPasswordAllowed: (...args: any[]) => mockAllowed(...args),
}));

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllowed.mockResolvedValue(undefined);
  });

  describe('the password rules', () => {
    it('refuses a new user whose password breaks a rule before Better Auth sees it', async () => {
      mockAllowed.mockRejectedValue(new ValidationError('The password needs a number.'));

      await expect(authService.createUser({ name: 'Lena Graf', email: 'lena@example.ch', password: 'Harbor-Lamp' })).rejects.toThrow('The password needs a number.');

      expect(mockAllowed).toHaveBeenCalledWith('Harbor-Lamp', { name: 'Lena Graf', email: 'lena@example.ch', password: 'Harbor-Lamp' });
      expect(mockSignUpEmail).not.toHaveBeenCalled();
    });

    it('checks a password an admin sets against the name and email of its user, and stores nothing it refuses', async () => {
      adapter.findUserById.mockResolvedValue({ id: 'u1', name: 'Lena Graf', email: 'lena@example.ch' });
      mockAllowed.mockRejectedValue(new ValidationError('The password may not contain the name or the email.'));

      await expect(authService.setPassword('u1', 'Grafenried-2026')).rejects.toBeInstanceOf(ValidationError);

      expect(mockAllowed).toHaveBeenCalledWith('Grafenried-2026', expect.objectContaining({ name: 'Lena Graf', email: 'lena@example.ch' }));
      expect(adapter.updatePassword).not.toHaveBeenCalled();
      expect(adapter.createAccount).not.toHaveBeenCalled();
    });

    it('replaces the hash of the credential account, or creates one for a user who signed in without a password', async () => {
      adapter.findUserById.mockResolvedValue({ id: 'u1', name: 'Lena Graf', email: 'lena@example.ch' });
      adapter.findAccounts.mockResolvedValueOnce([{ providerId: 'credential', password: 'old' }]).mockResolvedValueOnce([{ providerId: 'authentik' }]);

      await authService.setPassword('u1', 'Harbor-Lamp-42');
      await authService.setPassword('u1', 'Harbor-Lamp-43');

      expect(adapter.updatePassword).toHaveBeenCalledWith('u1', 'hash:Harbor-Lamp-42');
      expect(adapter.createAccount).toHaveBeenCalledWith({ userId: 'u1', providerId: 'credential', accountId: 'u1', password: 'hash:Harbor-Lamp-43' });
    });

    it('checks the current password against the stored hash, and fails without a password', async () => {
      adapter.findAccounts.mockResolvedValueOnce([{ providerId: 'credential', password: 'stored-hash' }]).mockResolvedValueOnce([]);
      password.verify.mockResolvedValue(false);

      expect(await authService.verifyPassword('u1', 'wrong')).toBe(false);
      expect(password.verify).toHaveBeenCalledWith({ hash: 'stored-hash', password: 'wrong' });
      expect(await authService.verifyPassword('u1', 'anything')).toBe(false);
      expect(password.verify).toHaveBeenCalledTimes(1);
    });
  });

  describe('createUser', () => {
    it('should call auth.api.signUpEmail with correct data', async () => {
      const userData = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      };

      mockSignUpEmail.mockResolvedValue({ user: { id: '1', ...userData } });

      const result = await authService.createUser(userData);

      expect(mockSignUpEmail).toHaveBeenCalledWith({
        body: userData,
      });
      expect(result).toEqual({ user: { id: '1', ...userData } });
    });

    it('should throw an error with message from body if signup fails', async () => {
      const error = {
        body: {
          message: 'Email already in use',
        },
      };
      mockSignUpEmail.mockRejectedValue(error);

      await expect(authService.createUser({
        name: 'Test',
        email: 'exists@example.com',
        password: 'pass',
      })).rejects.toThrow('Email already in use');
    });

    it('should throw generic error if structure is unknown', async () => {
       mockSignUpEmail.mockRejectedValue(new Error('Network error'));

       await expect(authService.createUser({
         name: 'Test',
         email: 'fail@example.com',
         password: 'pass',
       })).rejects.toThrow('Network error');
    });

     it('should throw generic fallback error if object has no message', async () => {
         mockSignUpEmail.mockRejectedValue({});

         await expect(authService.createUser({
             name: 'Test',
             email: 'fail@example.com',
             password: 'pass',
         })).rejects.toThrow('Failed to create user');
     });
  });
});
