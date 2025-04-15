const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const pageSize = 20; // Approx. number of results per page

// Folder to store screenshots
const screenshotFolder = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotFolder)) {
    fs.mkdirSync(screenshotFolder); // Create folder if it doesn't exist
}

async function scrapeGoogle({ businessName, keyword, area }) {
    const query = `${keyword} ${area}`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=lcl`;

    // Launch Puppeteer in maximized view
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--start-maximized', '--window-size=1920,1080']
    });

    const [page] = await browser.pages();
    await page.setViewport(null); // Ensures it matches window size

    let currentRank = 1;  // Track the current rank across pages
    let screenshotUrl = '';

    try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

        let rank = null;
        let pageCounter = 1;

        while (!rank && pageCounter <= 20) {
            await new Promise(r => setTimeout(r, 10000));
            console.log(`Scraping page ${pageCounter} for query: ${query}`);

            // Add numbering visually in browser, continue numbering across pages
            await page.evaluate((currentRank) => {
                const businessElements = document.querySelectorAll('.VkpGBb .dbg0pd');
                let count = currentRank;
                businessElements.forEach((el) => {
                    const isAd = el.innerText.includes('Sponsored') || el.innerText.includes('Ad') || el.innerText.includes('Google Guaranteed');
                    if (!isAd) {
                        const span = document.createElement('strong');
                        span.className = 'rank-number';
                        span.style.color = 'red';
                        span.style.marginRight = '6px';
                        span.textContent = `${count}.`;
                        el.prepend(span);
                        count++;
                    }
                });

            }, currentRank);  // Pass the current rank to the browser context

            // Get list of business names
            const results = await page.evaluate(() => {
                const businesses = [];
                const elements = document.querySelectorAll('.VkpGBb');

                elements.forEach(el => {
                    const nameEl = el.querySelector('.dbg0pd');
                    const isAd = el.innerText.includes('Sponsored') || el.innerText.includes('Ad') || el.innerText.includes('Google Guaranteed');

                    if (nameEl && !isAd) {
                        businesses.push(nameEl.textContent.trim());
                    }
                });

                return businesses;
            });


            console.log(`Results on page ${pageCounter}:`, results);

            // Match the business
            const businessIndex = results.findIndex(name =>
                name.toLowerCase().includes(businessName.toLowerCase())
            );

            if (businessIndex !== -1) {
                // Highlight the matched business box in light green
                await page.evaluate((index) => {
                    const businessBoxes = document.querySelectorAll('.VkpGBb');
                    if (businessBoxes[index]) {
                        businessBoxes[index].style.backgroundColor = '#d4edda'; // light green
                        businessBoxes[index].style.border = '2px solid #28a745'; // green border
                        businessBoxes[index].style.borderRadius = '8px';
                        businessBoxes[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, businessIndex);

                rank = (pageCounter - 1) * pageSize + businessIndex + 1;

                // Capture screenshot of the page
                const timestamp = new Date().toISOString().replace(/[^\w\s]/gi, '-'); // Format timestamp
                const screenshotPath = path.join(screenshotFolder, `${timestamp}.png`);
                await page.screenshot({ path: screenshotPath });

                // Set the screenshot URL
                screenshotUrl = `/screenshots/${timestamp}.png`;

                return { rank, page: pageCounter, screenshotUrl };
            }

            // Navigate to next page
            const nextButton = await page.$('a#pnnext');
            if (!nextButton) break;

            await Promise.all([
                nextButton.click(),
                page.waitForNavigation({ waitUntil: 'domcontentloaded' })
            ]);

            currentRank += pageSize;  // Increment the current rank for the next page
            pageCounter++;
        }

        return { rank: null, page: null };

    } catch (error) {
        console.error('Error during scraping:', error);
    } finally {
        // await browser.close(); // Uncomment if you want to auto-close browser
    }
}

// Serve the screenshot folder as static files
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

app.post('/scrape-google', async (req, res) => {
    const { businessName, keyword, area } = req.body;

    if (!businessName || !keyword || !area) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const data = await scrapeGoogle({ businessName, keyword, area });
        if (data.rank !== null) {
            res.json({ rank: data.rank, page: data.page, screenshotUrl: data.screenshotUrl });
        } else {
            res.json({ message: 'Business not found in the search results.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error scraping Google', error: error.message });
    }
});

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://127.0.0.1:${PORT}`);
});
