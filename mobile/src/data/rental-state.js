export function rentalDataStatusFor({ isLoading, loadedPageCount, failedPageCount, failedFirstPage }) {
  if (isLoading) return 'loading';
  if (loadedPageCount === 0 && failedFirstPage) return 'error';
  return failedPageCount > 0 ? 'partial' : 'ready';
}

export function shouldRefreshOnRetry({ currentCityId, sessionCityId, isLoading, failedPages }) {
  return !sessionCityId
    || sessionCityId !== currentCityId
    || isLoading
    || failedPages.length === 0
    || failedPages.includes(0);
}
