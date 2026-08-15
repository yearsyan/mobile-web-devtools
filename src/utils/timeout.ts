export function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  message: string,
  createError: (message: string) => Error = (reason) => new Error(reason),
): Promise<T> {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(createError(message)),
      timeout,
    ) as ReturnType<typeof setTimeout>;
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
