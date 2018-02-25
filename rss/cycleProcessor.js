/*
  Each batch of link maps (of length batchSize) in a batchList will have a forked rssProcessor
*/
const FeedParser = require('feedparser')
const requestStream = require('./request.js')
const connectDb = require('./db/connect.js')
const logLinkErr = require('../util/logLinkErrs.js')
const processLinkSources = require('./logic/cycle.js')
const log = require('../util/logger.js')
if (require('../config.json').logging.logDates === true) require('../util/logDates.js')()
let connected = false

function getFeed (link, rssList, uniqueSettings, debugFeeds) {
  const feedparser = new FeedParser()
  const articleList = []

  const cookies = (uniqueSettings && uniqueSettings.cookies) ? uniqueSettings.cookies : undefined
  let requested = false

  setTimeout(() => {
    if (!requested) {
      try {
        process.send({ status: 'failed', link: link, rssList: rssList })
        log.rss.error(`Unable to complete request for link ${link} during cycle, forcing status update to parent process`)
      } catch (e) {}
    }
  }, 90000)

  requestStream(link, cookies, feedparser, err => {
    requested = true
    if (!err) return
    logLinkErr({link: link, content: err})
    process.send({ status: 'failed', link: link, rssList: rssList })
  })

  feedparser.on('error', err => {
    logLinkErr({link: link, content: err})
    process.send({ status: 'failed', link: link, rssList: rssList })
    feedparser.removeAllListeners('end')
  })

  feedparser.on('readable', function () {
    let item

    while (item = this.read()) {
      articleList.push(item)
    }
  })

  feedparser.on('end', () => {
    if (articleList.length === 0) return process.send({status: 'success', link: link})
    let done = 0
    const total = Object.keys(rssList).length

    for (var rssName in rssList) {
      processLinkSources({ rssName: rssName, rssList: rssList, link: link, debugFeeds: debugFeeds, articleList: articleList }, (err, results) => {
        if (err) return log.rss.error(`Cycle logic`, err)
        if (results) process.send(results) // Could be Articles
        if (++done === total) process.send({ status: 'success', link: link })
      })
    }
  })
}

process.on('message', m => {
  if (!connected) {
    connected = true
    connectDb(err => {
      if (err) throw new Error(`Could not connect to SQL database for cycle.\n`, err)
      getFeed(m.link, m.rssList, m.uniqueSettings, m.debugFeeds)
    })
  } else getFeed(m.link, m.rssList, m.uniqueSettings, m.debugFeeds)
})
