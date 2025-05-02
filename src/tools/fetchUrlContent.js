import { requestGeminiChat } from '../services/aiRequest.js';
import { logger } from '../utils/logger.js';

// Function to fetch and extract content from a URL
async function fetchUrlContent(url, options = {}) {
  try {
    logger.info(`Fetching content from URL: ${url}`);
    
    // Get user's query/message if provided
    const userQuery = options.userQuery || options.lastMessage || '';
    logger.debug(`User query for content summary: "${userQuery}"`);
    
    // Validate URL
    let validatedUrl;
    try {
      validatedUrl = new URL(url);
    } catch (urlError) {
      logger.error(`Invalid URL: ${url}`);
      return {
        success: false,
        error: 'Invalid URL',
        message: `URL tidak valid: ${url}`
      };
    }
    
    // Check if protocol is http or https
    if (validatedUrl.protocol !== 'http:' && validatedUrl.protocol !== 'https:') {
      logger.error(`Unsupported protocol: ${validatedUrl.protocol}`);
      return {
        success: false,
        error: 'Unsupported protocol',
        message: `Protocol tidak didukung: ${validatedUrl.protocol}. Hanya http dan https yang diizinkan.`
      };
    }
    
    // Check if URL is from a file hosting service (safety check)
    const dangerousDomains = ['drive.google.com', 'docs.google.com', 'github.com', 'gitlab.com', 'amazonaws.com'];
    if (dangerousDomains.some(domain => validatedUrl.hostname.includes(domain))) {
      logger.warn(`Blocked file hosting domain: ${validatedUrl.hostname}`);
      return {
        success: false,
        error: 'URL blocked for security reasons',
        message: `URL dari domain ${validatedUrl.hostname} diblokir untuk alasan keamanan.`
      };
    }
    
    // Import required packages
    const puppeteer = await import('puppeteer');
    const turndown = await import('turndown');
    const TurndownService = turndown.default;
    
    logger.info('Launching headless browser to render page');
    
    // Launch puppeteer with improved settings for better JavaScript rendering
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-javascript',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage', // Helps with memory issues in Docker
        '--disable-accelerated-2d-canvas', // Reduces CPU usage
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Increase timeouts for better content loading
    await page.setDefaultNavigationTimeout(30000);
    
    // Set a more modern user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Enable JavaScript
    await page.setJavaScriptEnabled(true);
    
    // Set viewport for better rendering (larger to capture more content)
    await page.setViewport({
      width: 1920,
      height: 1080
    });
    
    // Intercept network requests to reduce unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      // Block unnecessary resources to speed up loading
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    try {
      // Navigate to the URL with improved waiting strategy
      logger.info(`Navigating to URL: ${url}`);
      await page.goto(url, { 
        waitUntil: ['networkidle2', 'domcontentloaded', 'load'],
        timeout: 30000
      });
      
      // Wait for common dynamic content selectors to appear
      logger.info('Waiting for content selectors to appear');
      await Promise.race([
        page.waitForSelector('article', { timeout: 3000 }).catch(() => {}),
        page.waitForSelector('main', { timeout: 3000 }).catch(() => {}),
        page.waitForSelector('#content', { timeout: 3000 }).catch(() => {}),
        page.waitForSelector('.content', { timeout: 3000 }).catch(() => {})
      ]).catch(() => {
        // This is fine if none of these selectors exist
      });
      
      // Additional wait for dynamic frameworks to render content
      // Using setTimeout with a promise instead of waitForTimeout
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // ---- NEW: Enhanced content loading strategy ----
      
      // 1. Check if page has infinite scroll or lazy loading elements
      logger.info('Checking for lazy-loaded content and performing smart scrolling');
      const hasLazyContent = await page.evaluate(() => {
        // Check for common lazy loading patterns
        return document.body.innerHTML.includes('lazy') || 
               document.body.innerHTML.includes('loading="lazy"') || 
               document.body.innerHTML.includes('data-src') ||
               document.body.innerHTML.includes('infinite') ||
               document.querySelectorAll('[data-lazy], [data-load], .lazy, .lazyload').length > 0;
      });
      
      // 2. Perform intelligent scrolling to trigger lazy loading
      if (hasLazyContent) {
        logger.info('Detected lazy loading, performing progressive scrolling');
        await page.evaluate(async () => {
          const scrollStep = window.innerHeight / 2;
          const scrollDelay = 1000;
          
          // Get initial document height
          let lastHeight = document.body.scrollHeight;
          let totalScrolls = 0;
          let noChangeCount = 0;
          
          function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
          }
          
          // Scroll down in steps, waiting for content to load
          while (totalScrolls < 10 && noChangeCount < 3) {
            window.scrollBy(0, scrollStep);
            await sleep(scrollDelay);
            
            // Check if the page height has changed
            if (document.body.scrollHeight > lastHeight) {
              lastHeight = document.body.scrollHeight;
              noChangeCount = 0;
            } else {
              noChangeCount++;
            }
            
            totalScrolls++;
          }
          
          // Scroll back to top
          window.scrollTo(0, 0);
        });
        
        // Wait for any newly loaded content
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // 3. Click "Read More" buttons or load more content buttons if they exist
      logger.info('Looking for and clicking "Read More" or "Load More" buttons');
      await page.evaluate(async () => {
        // Common button text patterns for expanding content
        const buttonPatterns = [
          'read more', 'load more', 'show more', 'view more', 'continue reading',
          'baca selengkapnya', 'muat lebih banyak', 'lihat selengkapnya', 'lanjutkan membaca',
          'more', 'expand', 'selengkapnya'
        ];
        
        // Find and click buttons that match these patterns
        const allElements = document.querySelectorAll('button, a, div, span');
        
        for (const element of allElements) {
          const text = element.innerText.toLowerCase().trim();
          const hasMatchingText = buttonPatterns.some(pattern => text.includes(pattern));
          
          if (hasMatchingText && element.offsetParent !== null) {
            try {
              element.click();
              // Wait for content to load
              await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
              // Ignore click errors
            }
          }
        }
      });
      
      // 4. Wait after clicking buttons
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 5. Expand all details/summary elements
      await page.evaluate(() => {
        document.querySelectorAll('details').forEach(detail => detail.setAttribute('open', true));
      });
      
      // Get page title
      const title = await page.title();
      logger.info(`Page title: "${title}"`);
      
      // Extract main content with improved selectors
      let mainContent = '';
      
      // Try extracting from main content selectors with more comprehensive list
      const mainSelectors = [
        'article', 'main', '[role="main"]', '.main-content', '#main-content',
        '.post-content', '.article-content', '.content', '#content',
        '.entry-content', '.post-body', '.article-body', '.story-body',
        '.news-content', '.blog-content', '.page-content', '.single-content',
        '.story-content', '#article-content', '[itemprop="articleBody"]',
        '.body-content', '.entry', '.post', '.article'
      ];
      
      // First attempt to find a main content container
      logger.info('Extracting main content from selectors');
      for (const selector of mainSelectors) {
        const element = await page.$(selector);
        if (element) {
          mainContent = await page.evaluate(el => el.innerText, element);
          if (mainContent && mainContent.length > 100) {
            logger.info(`Found content in selector: ${selector}`);
            break;
          }
        }
      }
      
      // If no main content found or it's too short, try a more advanced extraction method
      if (!mainContent || mainContent.length < 100) {
        logger.info('Using advanced content extraction method');
        mainContent = await page.evaluate(() => {
          // Get all text nodes in the document
          const textNodes = [];
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
          );
          
          // Skip common non-content elements
          const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'ASIDE'];
          const skipClasses = ['nav', 'menu', 'sidebar', 'footer', 'header', 'comment', 'widget'];
          
          let node;
          while (node = walker.nextNode()) {
            const parent = node.parentElement;
            
            // Skip if parent is in skipTags
            if (skipTags.includes(parent.tagName)) continue;
            
            // Skip if parent has any of the skipClasses
            if (Array.from(parent.classList).some(cls => 
              skipClasses.some(skipCls => cls.toLowerCase().includes(skipCls))
            )) continue;
            
            // Skip if hidden
            if (parent.offsetParent === null) continue;
            
            // Check if node has meaningful text
            const text = node.textContent.trim();
            if (text.length > 20) {
              textNodes.push({
                text,
                parent: parent.tagName,
                depth: getNodeDepth(parent)
              });
            }
          }
          
          // Get depth of an element in the DOM
          function getNodeDepth(element) {
            let depth = 0;
            let current = element;
            while (current) {
              depth++;
              current = current.parentElement;
            }
            return depth;
          }
          
          // Group text by parent depth (nodes at similar depths likely belong to the same content)
          const depthGroups = {};
          textNodes.forEach(node => {
            if (!depthGroups[node.depth]) {
              depthGroups[node.depth] = [];
            }
            depthGroups[node.depth].push(node.text);
          });
          
          // Find the depth with the most text content
          let maxTextLength = 0;
          let bestDepth = 0;
          
          Object.entries(depthGroups).forEach(([depth, texts]) => {
            const totalLength = texts.join('').length;
            if (totalLength > maxTextLength) {
              maxTextLength = totalLength;
              bestDepth = parseInt(depth);
            }
          });
          
          // Get content from the best depth and adjacent depths
          const contentNodes = textNodes.filter(node => 
            Math.abs(node.depth - bestDepth) <= 1
          );
          
          return contentNodes.map(node => node.text).join('\n\n');
        });
      }
      
      // If still no content, fallback to all paragraphs with improved text extraction
      if (!mainContent || mainContent.length < 100) {
        logger.info('Using paragraph fallback extraction method');
        mainContent = await page.evaluate(() => {
          // Get all elements that typically contain text content
          const contentElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div > div, li, blockquote');
          
          // Filter and process content
          return Array.from(contentElements)
            .filter(el => {
              // Skip empty elements or those with very little content
              if (!el.textContent || el.textContent.trim().length < 20) return false;
              
              // Skip hidden elements
              if (el.offsetParent === null) return false;
              
              // Skip elements with certain class names
              const classList = Array.from(el.classList).join(' ').toLowerCase();
              if (/nav|footer|header|sidebar|comment|widget|menu/.test(classList)) return false;
              
              return true;
            })
            .map(el => el.textContent.trim())
            .join('\n\n');
        });
      }
      
      // NEW: Try extracting content from iframes if main page content is insufficient
      if (!mainContent || mainContent.length < 200) {
        logger.info('Checking for content in iframes');
        const iframes = await page.$$('iframe');
        
        if (iframes.length > 0) {
          logger.info(`Found ${iframes.length} iframes, trying to extract content`);
          
          for (const frame of iframes) {
            try {
              // Get iframe source
              const src = await page.evaluate(el => el.src, frame);
              
              if (src && !src.includes('ads') && !src.includes('tracker') && !src.includes('analytics')) {
                // Navigate to iframe source
                const iframePage = await browser.newPage();
                await iframePage.goto(src, { waitUntil: 'networkidle2', timeout: 10000 });
                
                // Extract content from iframe
                const iframeContent = await iframePage.evaluate(() => {
                  return document.body.innerText;
                });
                
                // Close iframe page
                await iframePage.close();
                
                // If iframe has meaningful content, use it
                if (iframeContent && iframeContent.length > 200) {
                  mainContent = iframeContent;
                  logger.info('Successfully extracted content from iframe');
                  break;
                }
              }
            } catch (e) {
              logger.warn(`Error extracting iframe content: ${e.message}`);
            }
          }
        }
      }
      
      // Get more structured data using schema.org metadata if available
      logger.info('Extracting structured data');
      const structuredData = await page.evaluate(() => {
        const schemaElements = document.querySelectorAll('[itemtype*="schema.org"], script[type="application/ld+json"]');
        
        let data = [];
        
        // Extract JSON-LD
        document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
          try {
            const json = JSON.parse(el.textContent);
            data.push(json);
          } catch (e) {}
        });
        
        // Extract microdata
        schemaElements.forEach(el => {
          if (el.tagName !== 'SCRIPT') {
            const type = el.getAttribute('itemtype');
            const props = {};
            
            el.querySelectorAll('[itemprop]').forEach(prop => {
              const name = prop.getAttribute('itemprop');
              let value;
              
              if (prop.tagName === 'META') {
                value = prop.getAttribute('content');
              } else if (prop.tagName === 'IMG') {
                value = prop.getAttribute('src');
              } else {
                value = prop.textContent.trim();
              }
              
              props[name] = value;
            });
            
            if (Object.keys(props).length > 0) {
              data.push({
                '@type': type,
                ...props
              });
            }
          }
        });
        
        return data;
      });
      
      // Get full HTML content
      const fullHtml = await page.content();
      
      // Check for anti-scraping mechanisms and adjust if needed
      const isBlocked = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        return bodyText.includes('captcha') || 
               bodyText.includes('robot') ||
               bodyText.includes('blocked') ||
               bodyText.includes('access denied');
      });
      
      if (isBlocked) {
        logger.warning('Possible anti-scraping mechanism detected, trying alternative approach');
        
        // Try another approach with a small delay and different user agent
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15');
        await page.reload({ waitUntil: 'networkidle2' });
        
        // Using setTimeout with a promise instead of waitForTimeout
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Try extraction again with broader selector range
        mainContent = await page.evaluate(() => {
          const paragraphs = document.querySelectorAll('p, h1, h2, h3, h4, h5, article, section, div > div');
          return Array.from(paragraphs)
            .map(p => p.innerText.trim())
            .filter(text => text.length > 20)
            .join('\n\n');
        });
      }
      
      // Convert HTML to Markdown with improved settings
      logger.info('Converting HTML to Markdown');
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        hr: '---',
        strongDelimiter: '**'
      });
      
      // Add plugins or rules to improve conversion
      turndownService.addRule('removeEmptyParagraphs', {
        filter: node => {
          return node.nodeName === 'P' && node.textContent.trim() === '';
        },
        replacement: () => ''
      });
      
      // Improve image handling
      turndownService.addRule('images', {
        filter: 'img',
        replacement: function(content, node) {
          const alt = node.alt || '';
          const src = node.getAttribute('src') || '';
          if (!src) return '';
          return `![${alt}](${src})`;
        }
      });
      
      const markdown = turndownService.turndown(fullHtml);
      
      // NEW: Verify content quality and length
      const contentQualityCheck = mainContent.length > 500;
      logger.info(`Content quality check: ${contentQualityCheck ? 'PASS' : 'FAIL'} (${mainContent.length} chars)`);
      
      // If content quality is poor, try one more extraction approach
      if (!contentQualityCheck) {
        logger.info('Content quality check failed, trying final extraction approach');
        
        // Try an additional extraction method focusing on the densest content areas
        mainContent = await page.evaluate(() => {
          // Get all elements with substantial text
          const elements = Array.from(document.querySelectorAll('*'))
            .filter(el => {
              const text = el.innerText || '';
              return text.length > 100 && 
                     !['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(el.tagName);
            })
            .map(el => ({
              element: el,
              textLength: el.innerText.length,
              childCount: el.children.length,
              textDensity: el.innerText.length / (el.children.length || 1)
            }))
            .sort((a, b) => b.textDensity - a.textDensity);
          
          // Get the highest density elements
          const topElements = elements.slice(0, 5);
          return topElements.map(item => item.element.innerText).join('\n\n');
        });
      }
      
      // Truncate markdown if too long (keep important parts)
      const maxMarkdownLength = 8000; // Increased from 5000
      let truncatedMarkdown = markdown;
      if (markdown.length > maxMarkdownLength) {
        truncatedMarkdown = markdown.substring(0, maxMarkdownLength) + '... (content truncated)';
      }
      
      // Clean up content
      mainContent = mainContent
        .replace(/\s+/g, ' ')      // Replace multiple whitespace with single space
        .replace(/\n\s+/g, '\n')   // Remove leading spaces after newlines
        .trim();                   // Trim leading/trailing whitespace
      
      // Truncate if too long (increased limit for better completeness)
      const maxLength = 4000; // Increased from 2000
      let truncatedContent = mainContent;
      if (mainContent.length > maxLength) {
        truncatedContent = mainContent.substring(0, maxLength) + '... (content truncated)';
        logger.info(`Content truncated from ${mainContent.length} to ${maxLength} chars`);
      }
      
      // Close browser
      await browser.close();
      
      logger.success(`Successfully extracted content from URL (${truncatedMarkdown.length} chars of markdown)`);
      
      // Use Gemini to generate a natural summary of the content
      logger.info('Generating AI summary of web content');
      const apiKey = process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        logger.warning('No Gemini API key found, returning raw content without AI summary');
        
        // NEW: Save content to memory
        try {
          // Import the memory service function
          const { storeWebContent } = await import('../services/memoryService.js');
          
          // Store the URL content
          await storeWebContent(url, title, truncatedContent, {
            fullContent: mainContent,
            markdown: truncatedMarkdown,
            userQuery: userQuery,
            structuredData: structuredData
          });
          logger.info(`Saved web content from "${url}" to memory`);
        } catch (memoryError) {
          logger.warning(`Failed to save URL content to memory: ${memoryError.message}`);
        }
        
        return {
          success: true,
          title: title,
          url: url,
          content: truncatedContent,
          markdown: truncatedMarkdown,
          fullContent: mainContent,
          structuredData: structuredData,
          message: `# ${title}\n\n${truncatedContent}\n\nSumber: ${url}`
        };
      }
      
      // Format messages for Gemini, including the user's original query if available
      const promptContent = `Kamu adalah AI asisten yang diminta untuk meringkas konten dari halaman web.
      
Berikut adalah konten dalam format markdown dari halaman "${title}" (${url}):

${truncatedMarkdown}

${userQuery ? `Pengguna bertanya atau meminta: "${userQuery}"

Berikan ringkasan yang langsung berhubungan dengan pertanyaan/permintaan pengguna, jika relevan.` : 'Berikan ringkasan umum dari konten halaman web ini.'}

PENTING: Fokus HANYA pada isi substantif dan informasi utama halaman web. JANGAN meringkas atau menjelaskan:
- Elemen navigasi (menu, link, footer)
- UI/UX halaman (header, sidebar, layout)
- Tema visual atau tata letak halaman
- Komponen website seperti form login, panel pencarian, dll
- Struktur situs (beranda, toko, dll)
- Informasi yang tidak berkaitan dengan konten utama

Tolong berikan ringkasan informatif dan natural dari konten substantif di atas. Fokus pada: 

1. Informasi utama dan kunci dari konten (produk, artikel, berita, dll)
2. Fakta-fakta relevan, harga, tanggal, dan statistik penting
3. Kesimpulan utama atau poin penting dari artikel/halaman
${userQuery ? `4. Informasi yang secara langsung menjawab pertanyaan pengguna: "${userQuery}"` : ''}

Untuk halaman produk atau game: Fokus pada deskripsi produk, fitur, harga, spesifikasi, ulasan pengguna, dll.
Untuk artikel/berita: Fokus pada fakta/informasi utama, penulis, tanggal, quotes penting.
Untuk halaman informasi: Fokus pada topik, data/fakta substantif, poin-poin kunci.

Format responsenya dalam paragraf yang mudah dibaca. Harus menyebutkan sumber (URL). Jangan menyebutkan bahwa ini adalah ringkasan. Cukup berikan informasinya langsung dengan bahasa yang natural, seperti kamu sedang menjelaskan konten halaman ini kepada pengguna. Pastikan responsenya panjangnya tidak lebih dari 400 kata.`;

      const messages = [
        { 
          role: 'user', 
          content: promptContent
        }
      ];
      
      // Request AI summary from Gemini
      const aiSummaryResponse = await requestGeminiChat(
        'gemini-2.0-flash',
        apiKey,
        messages,
        {
          temperature: 0.3,
          top_p: 0.85,
          max_tokens: 1500
        }
      );
      
      // Extract summary from response
      let aiSummary = '';
      if (aiSummaryResponse?.choices?.[0]?.message?.content) {
        aiSummary = aiSummaryResponse.choices[0].message.content;
      } else {
        // Fallback if there's an issue with AI summary
        logger.warning('Couldn\'t get AI summary, falling back to raw content');
        aiSummary = truncatedContent;
      }
      
      // Create the final message with AI summary and source
      const finalMessage = `# ${title}\n\n${aiSummary}\n\nSumber: ${url}`;
      
      // NEW: Save content to memory with AI summary
      try {
        // Import the memory service function
        const { storeWebContent } = await import('../services/memoryService.js');
        
        // Store the URL content with AI summary
        await storeWebContent(url, title, truncatedContent, {
          fullContent: mainContent,
          markdown: truncatedMarkdown,
          userQuery: userQuery,
          aiSummary: aiSummary,
          structuredData: structuredData
        });
        logger.info(`Saved web content from "${url}" to memory with AI summary`);
      } catch (memoryError) {
        logger.warning(`Failed to save URL content to memory: ${memoryError.message}`);
      }
      
      return {
        success: true,
        title: title,
        url: url,
        content: truncatedContent,
        markdown: truncatedMarkdown,
        fullContent: mainContent,
        aiSummary: aiSummary,
        structuredData: structuredData,
        message: finalMessage
      };
    } catch (error) {
      logger.error(`Error fetching content from URL: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Maaf, terjadi kesalahan saat mengambil konten dari URL: ${error.message}`
      };
    }
  } catch (error) {
    logger.error(`Error fetching content from URL: ${error.message}`);
    return {
      success: false,
      error: error.message,
      message: `Maaf, terjadi kesalahan saat mengambil konten dari URL: ${error.message}`
    };
  }
}

export default fetchUrlContent;