import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const error =
      typeof exceptionResponse === 'string'
        ? { message: exceptionResponse }
        : (exceptionResponse as object);

    // A 429 that knows when the window frees up says so the standard way.
    const retryAfter = (error as { retryAfterSeconds?: unknown })
      .retryAfterSeconds;
    if (
      status === HttpStatus.TOO_MANY_REQUESTS &&
      typeof retryAfter === 'number'
    ) {
      response.setHeader('Retry-After', String(retryAfter));
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...error,
    });
  }
}
