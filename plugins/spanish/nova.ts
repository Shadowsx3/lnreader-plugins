import { fetchApi } from '@libs/fetch';
import { Filters } from '@libs/filterInputs';
import { Plugin } from '@/types/plugin';
import { load as parseHTML, CheerioAPI } from 'cheerio';

class NOVA implements Plugin.PluginBase {
  id = 'novelasligeras.net';
  name = 'NOVA';
  icon = 'src/es/nova/icon.png';
  site = 'https://novelasligeras.net';
  version = '1.0.1';
  filters?: Filters | undefined;

  private readonly searchAjax =
    '/wp-admin/admin-ajax.php?tags=1&sku=&limit=30&category_results=&order=DESC&category_limit=5&order_by=title&product_thumbnails=1&title=1&excerpt=1&content=&categories=1&attributes=1';

  private checkCaptcha = ($: CheerioAPI) => {
    const title = $('title').text();
    if (
      title === 'Attention Required! | Cloudflare' ||
      title === 'Just a moment...'
    ) {
      throw new Error('Captcha error, please open in webview');
    }
  };

  // Popular just proxies to search with empty term
  async popularNovels(page = 1): Promise<Plugin.NovelItem[]> {
    return this.searchNovels('', page);
  }

  async searchNovels(
    searchTerm: string,
    page = 1,
  ): Promise<Plugin.NovelItem[]> {
    if (page <= 1) {
      const url = this.site + this.searchAjax;

      const form = new FormData();
      form.append('action', 'product_search');
      form.append('product-search', String(page));
      form.append('product-query', searchTerm);

      const res = await fetchApi(url, { method: 'POST', body: form as any });
      const txt = await res.text();

      const arr = JSON.parse(txt) as {
        title: string;
        thumbnail: string;
        url: string;
      }[];

      return arr.map(novel => ({
        name: novel.title,
        cover: novel.thumbnail,
        path: novel.url.replace(this.site, ''),
      }));
    }

    const url = `${this.site}/index.php/page/${page}/?s=${encodeURIComponent(
      searchTerm,
    )}&post_type=product&title=1&excerpt=1&content=0&categories=1&attributes=1&tags=1&sku=0&orderby=popularity&ixwps=1`;

    const res = await fetchApi(url);
    const html = await res.text();
    const $ = parseHTML(html);

    this.checkCaptcha($);

    const novels: Plugin.NovelItem[] = [];
    $('.dt-css-grid')
      .find('div.wf-cell')
      .each((_, el) => {
        const cell = $(el);
        const a = cell.find('h4.entry-title a');
        const img = cell.find('img');

        const novelUrl = (a.attr('href') || '').replace(this.site, '');
        const cover =
          img.attr('data-src') ||
          img.attr('data-cfsrc') ||
          img.attr('src') ||
          '';

        novels.push({
          name: a.text().trim(),
          cover,
          path: novelUrl,
        });
      });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = this.site + novelPath;

    const res = await fetchApi(url);
    const body = await res.text();

    const $ = parseHTML(body);
    this.checkCaptcha($);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $('h1').first().text().trim() || 'Untitled',
    };

    const galleryImg = $('.woocommerce-product-gallery').find('img');
    novel.cover =
      galleryImg.attr('src') ||
      galleryImg.attr('data-cfsrc') ||
      galleryImg.attr('data-src') ||
      '';

    novel.author = $(
      '.woocommerce-product-attributes-item--attribute_pa_escritor td',
    )
      .text()
      .trim();
    novel.artist = $(
      '.woocommerce-product-attributes-item--attribute_pa_ilustrador td',
    )
      .text()
      .trim();
    novel.status = $(
      '.woocommerce-product-attributes-item--attribute_pa_estado td',
    )
      .text()
      .trim();

    const summaryHtml =
      $('.woocommerce-product-details__short-description').html() || '';
    novel.summary = parseHTML(summaryHtml).text().trim();

    const chapters: Plugin.ChapterItem[] = [];
    $('.vc_row div.vc_column-inner > div.wpb_wrapper').each((_, wrap) => {
      const e = $(wrap);
      const volume = e.find('.dt-fancy-title').first().text().trim();
      if (!/^Volumen/i.test(volume)) return;

      e.find('.wpb_tab a').each((_, aEl) => {
        const $a = $(aEl);
        const chapterPartName = $a.text().trim();
        const chapterUrl = ($a.attr('href') || '').replace(this.site, '');

        const match = chapterPartName.match(/(Parte \d+)\s*.\s*(.+?):\s*(.+)/i);
        const part = match?.[1];
        const chapter = match?.[2];
        const name = match?.[3];

        const chapterName =
          part && chapter
            ? `${volume} - ${chapter} - ${part}: ${name}`
            : `${volume} - ${chapterPartName}`;

        chapters.push({
          name: chapterName,
          path: chapterUrl,
        });
      });
    });

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = this.site + chapterPath;

    const res = await fetchApi(url);
    const body = await res.text();

    const $ = parseHTML(body);
    this.checkCaptcha($);

    // Select the correct content container
    const $content = body.includes(
      'Nadie entra sin permiso en la Gran Tumba de Nazarick',
    )
      ? $('#content')
      : $('.wpb_text_column.wpb_content_element > .wpb_wrapper');

    // Remove inline ad <center> blocks
    $content.find('center').each((_, el) => {
      $(el).remove();
    });

    // Normalize style-centered elements into <center> wrappers
    $content.find('*').each((_, el) => {
      const style = ($(el).attr('style') || '').toLowerCase();
      if (style.includes('text-align') && style.includes('center')) {
        const inner = $(el).html() || '';
        $(el).replaceWith(`<center>${inner}</center>`);
      }
    });

    return $content.html() || '';
  }
}

export default new NOVA();
