
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authService } from '@/services/auth-service';

// Mock the auth library
const mockSignUpEmail = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      signUpEmail: (...args: any[]) => mockSignUpEmail(...args),
    },
  },
}));

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
