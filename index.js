require("dotenv").config({ path: __dirname + "/.env" });
const express = require("express");
const app = express();
const port = process.env.PORT || 8080;
const { Configuration, OpenAIApi } = require("openai");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});
const puppeteer = require("puppeteer");

const { fetchWhatsNew } = require("./scrape_whatsnew.js"); // import the function
const { google } = require("googleapis");

const youtubeApiKey = process.env.YouTube_API_KEY;

// YouTube Data API client
const youtube = google.youtube({
  version: "v3",
  auth: youtubeApiKey,
});

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

const { twitterClient } = require("./twitterClient.js");

const youtubefeeds = require("./youtubefeeds.json");

const { fetchBlogPosts } = require("./scrape_blogs.js"); // import the function

const tweetNewRows = async () => {
  try {
    const data = await prisma.BlogPost.findMany({
      where: {
        tweeted: false,
      },
    });
    data.forEach(async (row) => {
      const { title, content, author, url } = row;
      try {
        const prompt = `Your answer can only be 18 words long. Summarize the following text. Dont use the title to summarize the article. Focus on the content. Your summary should be different from the Title. Dont add any tags or hashwords with # and dont tell people were to download or get a script. Dont use the title and header of the text in your response. Be precise as possible without exceeding 20 words in your response. \n\n${content}.`;
        const aiResponse = await openai.createChatCompletion({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: `${prompt}` }],
          temperature: 0.2,
        });
        let truncatedTitle = title;
        if (title.length > 40) {
          truncatedTitle = title.slice(0, 40) + "...";
        }
        const summary = aiResponse.data.choices[0].message.content;
        const tweetText = `${truncatedTitle}\n\n${summary}\n\n${url} ${author}\n\n#Intune #Microsoft`;
        await twitterClient.v2.tweet(tweetText);
        console.log(`Tweeted: ${tweetText}`);
        await prisma.BlogPost.update({
          where: {
            id: row.id,
          },
          data: {
            tweeted: true,
          },
        });
      } catch (e) {
        console.log(e);
      }
    });
  } catch (e) {
    console.log(e);
  }
};

const tweetNewCommits = async () => {
  try {
    const data = await prisma.WhatsNew.findMany({
      where: {
        tweeted: false,
      },
    });
    data.forEach(async (row) => {
      const { title, url } = row;
      try {
        const tweetText = `Detected changes in the "What's new in Microsoft Intune" docs:\n\n${title}\n\n#Intune #Microsoft\n\n${url}`;
        await twitterClient.v2.tweet(tweetText);
        console.log(`Tweeted: ${tweetText}`);
        await prisma.WhatsNew.update({
          where: {
            id: row.id,
          },
          data: {
            tweeted: true,
          },
        });
      } catch (e) {
        console.log(e);
      }
    });
  } catch (e) {
    console.log(e);
  }
};

let lastCheckedDate = null;

const getNewVideos = async (channelId, channelName) => {
  try {
    const response = await youtube.search.list({
      part: "snippet",
      channelId: channelId,
      order: "date",
      type: "video",
      maxResults: 5,
    });
    const latestVideoDate = new Date(
      response.data.items[0].snippet.publishedAt
    );
    if (latestVideoDate > lastCheckedDate) {
      const latestVideoTitle = response.data.items[0].snippet.title;
      const latestVideoLink = `https://www.youtube.com/watch?v=${response.data.items[0].id.videoId}`;
      const tweetText = `New video on the ${channelName} YouTube channel: ${latestVideoTitle}\n\n${latestVideoLink}\n\n#Intune #Microsoft #YouTube`;
      await twitterClient.v2.tweet(tweetText);
      lastCheckedDate = latestVideoDate;
      console.log(`Checked ${channelName} successfully`);
    }
  } catch (error) {
    console.error(
      `Error while getting new videos for ${channelName}: ${error.message}`
    );
  }
};

// TWEET RESULUTS EVERY 15 MINUTES
const interval = setInterval(async () => {
  await tweetNewRows();
  await tweetNewCommits();
}, 30 * 60 * 1000);

// GET DATA EVERY 5 MINUTES
setInterval(async () => {
  await fetchBlogPosts();
  await fetchWhatsNew();

  for (const channel of youtubefeeds) {
    await getNewVideos(channel.channelId, channel.channelName);
  }
}, 15 * 60 * 1000);

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
