export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_FAILED'
  | 'NOT_FOUND'
  | 'SLOT_FULL'
  | 'SLOT_UNAVAILABLE'
  | 'DUPLICATE_BOOKING'
  | 'INVALID_STATE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'CHECKIN_WINDOW_CLOSED'
  | 'LATE_ARRIVAL_REASON_REQUIRED'
  | 'GRACE_PERIOD_ACTIVE'
  | 'DOCTOR_PAUSED'
  | 'DOCTOR_INACTIVE'
  | 'CONSULTATION_ACTIVE'
  | 'NO_PATIENTS_WAITING'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'SLOT_CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const errors = {
  validation: (message: string, details?: unknown) => new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.'),
  forbidden: (message = 'You do not have permission to do that.') => new AppError(403, 'FORBIDDEN', message),
  notFound: (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found.`),
  conflict: (code: ErrorCode, message: string, details?: unknown) => new AppError(409, code, message, details),
  unprocessable: (code: ErrorCode, message: string) => new AppError(422, code, message),
};
