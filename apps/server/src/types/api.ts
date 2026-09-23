export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  /** Present on 500 responses; matches the request id in the log entry. */
  requestId?: string;
}
