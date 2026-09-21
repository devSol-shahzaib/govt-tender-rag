import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { ValidationError } from '../utils/AppError.js';

/**
 * Validates and replaces the request body.
 *
 * No asyncHandler wrapper: Express 5 forwards both thrown errors and rejected
 * promises from a handler to the error middleware on its own (D013).
 */
export function validate(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((issue) => ({
          field: issue.path.join('.') || '(body)',
          message: issue.message,
        }));

        throw new ValidationError(
          details.map((d) => `${d.field}: ${d.message}`).join('; '),
          details,
        );
      }

      throw error;
    }
  };
}
