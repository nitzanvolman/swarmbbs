/**
 * Error Handling Framework for SwarmBBS
 *
 * Provides structured error responses with codes, context, and next steps
 */

/**
 * SwarmBBS Error with code, context, and actionable next steps
 */
export class SwarmBBSError extends Error {
  constructor(
    public code: number,
    message: string,
    public context?: Record<string, unknown>,
    public nextSteps?: string
  ) {
    super(message);
    this.name = 'SwarmBBSError';
    Error.captureStackTrace(this, SwarmBBSError);
  }

  toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      nextSteps: this.nextSteps,
    };
  }
}

/**
 * 400 Bad Request - Invalid input
 */
export function badRequest(message: string, context?: Record<string, unknown>, nextSteps?: string): SwarmBBSError {
  return new SwarmBBSError(400, message, context, nextSteps);
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export function notFound(resource: string, identifier: string, nextSteps?: string): SwarmBBSError {
  return new SwarmBBSError(
    404,
    `${resource} '${identifier}' not found`,
    { resource, identifier },
    nextSteps || `Create the ${resource} first or check the name spelling`
  );
}

/**
 * 409 Conflict - Resource conflict
 */
export function conflict(message: string, context?: Record<string, unknown>, nextSteps?: string): SwarmBBSError {
  return new SwarmBBSError(409, message, context, nextSteps);
}

/**
 * 413 Payload Too Large
 */
export function payloadTooLarge(
  entityType: string,
  limitBytes: number,
  receivedBytes: number,
  nextSteps?: string
): SwarmBBSError {
  return new SwarmBBSError(
    413,
    `${entityType} exceeds ${limitBytes} byte limit (received ${receivedBytes} bytes)`,
    { entity_type: entityType, limit_bytes: limitBytes, received_bytes: receivedBytes },
    nextSteps || `Split ${entityType} into smaller parts or reduce content size`
  );
}

/**
 * 423 Locked - Lock acquisition failed
 */
export function locked(resource: string, context?: Record<string, unknown>): SwarmBBSError {
  return new SwarmBBSError(
    423,
    `Could not acquire lock on ${resource} after timeout`,
    context,
    'Retry after brief delay; if persistent, check for deadlock'
  );
}

/**
 * 507 Insufficient Storage
 */
export function insufficientStorage(message: string, context?: Record<string, unknown>): SwarmBBSError {
  return new SwarmBBSError(
    507,
    message,
    context,
    'Contact administrator to free disk space or increase quota'
  );
}

/**
 * 500 Internal Server Error
 */
export function internalError(message: string, context?: Record<string, unknown>): SwarmBBSError {
  return new SwarmBBSError(500, message, context, 'Check server logs for details');
}
