declare module "rss" {
  type FeedOptions = {
    title: string;
    description?: string;
    site_url?: string;
    feed_url?: string;
    language?: string;
  };

  type ItemOptions = {
    title: string;
    url?: string;
    description?: string;
    guid?: string;
    date?: Date | string;
  };

  export default class RSS {
    constructor(options: FeedOptions);
    item(options: ItemOptions): this;
    xml(indent?: boolean | string): string;
  }
}
