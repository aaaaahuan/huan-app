export type PageStatus = 'loading' | 'ready' | 'unavailable' | 'unsupported';
export type PageContent = { title: string; text: string; truncated: boolean };
export type PageSnapshot = PageContent & {
  id: string;
  url: string;
  status: PageStatus;
  capturedAt?: number;
};
export type PageContext = { currentPageId?: string; pages: PageSnapshot[] };
export type PageSource = Pick<PageSnapshot, 'id' | 'title' | 'url' | 'capturedAt' | 'truncated'>;
