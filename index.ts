import * as puppeteer from 'puppeteer';
import * as readline from 'readline';
import * as fs from 'fs';
import * as jimp from 'jimp';
import * as qrcode from 'qrcode-terminal';

const closeBrowserAndQuit = browser => {
    let closing = false;
    return async () => {
        console.log("Shutting down...");
        if(!closing){
            closing = true;
            try{ await browser.close(); } catch(e) {}                
        }
        process.exit();
    }
};

(() => {
    if (process.platform === "win32") {
        readline.createInterface({
            input: process.stdin,
            output: process.stdout
        }).on("SIGINT", () => process.emit("SIGINT"));
    }
})();

(async () => {
    const browser = await puppeteer.launch();
    process.on("SIGINT", closeBrowserAndQuit(browser));
    
    try {
        const page = await browser.newPage();
        
        page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.78 Safari/537.36");
        
        console.log("Loading...");
        await page.goto('https://web.whatsapp.com');
        
        const qrFile = "qr.png";
        await (await page.$('img')).screenshot({path: qrFile});
        const image = await jimp.read(fs.readFileSync(qrFile));
        const qrDecoder = new (require('qrcode-reader'))();
        qrDecoder.callback = function(error, result) {
            if(error) throw error;
            qrcode.generate(result.result);
        }
        qrDecoder.decode(image.bitmap)
        console.log("Scan QR code with WhatsApp on your phone tp log in");
        fs.unlink(qrFile, err => console.error(err||""));
        
        await page.waitFor(".chatlist-panel-body", {timeout:60000});
        console.log("Log in success!");
        
        const people = await page.$$('.chat-title > span');
        
        for(let i = 0; i < people.length; i++)
            console.log(`${i + 1} - ${await (await people[i].getProperty('textContent')).jsonValue()}`);
        
    } catch(e) {
        console.error(e);
        closeBrowserAndQuit(browser)();
    }
})();