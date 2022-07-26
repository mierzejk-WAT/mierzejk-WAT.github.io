const Controller = class {
  constructor(tileContainer) {
	this.timeFormatter = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
    this.modelArgs = ['https://cors-anywhere.herokuapp.com', 12, 16];
    this.container = tileContainer;
	this.noArticle = {displayMode: 'article-loading-template', article: null, gallery: true};
	this.unavailableArticle = {displayMode: 'article-unavailable-template', article: null, gallery: true};
	this.model = new Model(...this.modelArgs);
	this.LoadingArticle = ko.observable(true);
	this.LoadingVideo = ko.observable(false);
	this.Loading = {
      value: ko.pureComputed(() => this.LoadingArticle() || this.LoadingVideo()),
	  label: ko.observable('Wczytaj kolejne artykuły...')};
	this.Article = ko.observable(this.noArticle);
  }
  
  ClearArticle() {
    this.Article(this.noArticle);
  }
  
  SetArticleUnavailable() {
    this.Article(this.unavailableArticle);
  }
  
  SetArticle(data) {
    switch (data.t) {
      case 'Video':
	    data.video = ko.observable(false);
	    data.videoUnavailable = ko.observable(false);
	    let manifest = Controller.ExtractManifest(data);
		if (manifest) {
			this.LoadVideoData(manifest, data.video, () => data.videoUnavailable(true));
		}
	    this.Article({displayMode: 'article-video-template', article: data, gallery: false});
	    break;
      case 'Gallery':
	    if (data.entities.length) {
	      this.Article({displayMode: 'article-gallery-template', article: data, gallery: true});
		  $('.flexslider').flexslider({ animation: "slide", slideshow: false, start: this.ResetSlider });
		  break; }
	  default:
	    this.Article({displayMode: 'article-text-template', article: data, gallery: false});
	    break;
	}
  }
  
  ArticlesLoaded(articles) {
    const newRow = $('<row-component>');
	ko.applyBindings(articles, newRow[0]);
	this.container.append(newRow);
	Controller.Scroll(newRow);
	this.LoadingArticle(false);
  }
  
  LoadArticle(url, type) {
	this.LoadingArticle(true);
	this.Request = this.model.GetArticle(
	  url,
	  $.proxy(this.SetArticle, this),
	  $.proxy((_, status) => {if ('abort' !== status) this.SetArticleUnavailable(); }, this),
	  $.proxy(() => this.LoadingArticle(false), this),
	  'Gallery' === type);
  }
  
  LoadArticles() {
	this.LoadingArticle(true);
	this.model.GetArticles()
	  .catch($.proxy(err => {
	    if (this.model.NoDataError === err.message) {
		  this.Loading.label('Brak dostępnych artykułów');
          if (err.articles && err.articles.length) {
		    this.ArticlesLoaded(err.articles); }}
		else {
		  throw err; }}, this))
	  .then(articles => this.ArticlesLoaded(articles));
  }
  
  LoadVideoData(url, observable, fail) {
    this.LoadingVideo(true);
	this.Request = this.model.GetVideoData(
	  url,
	  observable,
	  fail,
	  $.proxy(() => this.LoadingVideo(false), this));
  }
  
  RefreshView() {
    this.model = new Model(...this.modelArgs);
	this.Loading.label('Wczytaj kolejne artykuły...');
    $('row-component').remove();
	this.LoadArticles();
  }
  
  ResetSlider(timeout) {
    const slider = $('.flexslider').data('flexslider');
	if (!slider) {
      return; }
	const speed = slider.vars.animationSpeed;
	slider.vars.animationSpeed = 0;
    const setZero = () => {
      slider.flexAnimate(0, true, true);
      slider.vars.animationSpeed = speed; }
	if (timeout) {
	  setTimeout(setZero, timeout); }
	else {
      setZero();
	}
  }
  
  FormatDate(ts) {
    const date = new Date(1e3 * ts), timeStr = this.timeFormatter.format(date);
	const dayDiff = Math.floor((new Date((new Date).toDateString()) - new Date(date.toDateString())) / 86400000);
	switch (dayDiff) {
	  case 0:
	  return timeStr;
	  case 1:
	  return `wczoraj, ${timeStr}`;
	  case 2:
	  return `przedwczoraj, ${timeStr}`;
	  default:
	  return `${dayDiff} dni temu`;
	};
  }
  
  static ExtractManifest(data) {
	  let indices = [];
	  const manifests = data.body.filter((b, i) => {
        if (b.data.match(/^http\S+embed\.json$/i)) {
          indices.unshift(i);
		  return true;
		}
		return false;})
		.map(b => b.data);
	  if (manifests.length) {
        data.manifest = manifests[0];
		indices.forEach(i => data.body.splice(i, 1));
	  }
	  return data.manifest || null;
  }
  
  static Scroll(element) {
    $('html, body').animate({ scrollTop: element.offset().top}, 500, 'linear');
  }
  
}

const Model = class {
	
  constructor(url, queryLimit = 12, queryBuffer = queryLimit, maxEmptyResultsQueries = 5) {
	this.NoDataError = "No more data";
    this.baseUrl = url;
	this.taken = 0;
	this.currentBucket = false;
	this.online = true;
	if (queryLimit < 1 || queryBuffer < 1) {
      this[Symbol.iterator] = function* () { return; };
	}
	else {
	  this.limit = queryLimit;
	  this.buffer = queryBuffer;
	  this.maxEmptyResultsNo = maxEmptyResultsQueries;
	  this.storage = [[], ...(Storages.localStorage.get("articles") || [])];
    }
  }
  
  async GetArticles() {
	let resultNumber = 0;
	try {
      for (const value of this) {
        this.storage[0].push(await value);
		resultNumber++;
	  }}
	catch (err) {
	  err.articles = this.storage[0].slice(-resultNumber);
	  throw err; }
	finally {
	  if (this.online) {
	    Storages.localStorage.set("articles", this.storage); }}

	return this.storage[0].slice(-resultNumber);
  }
  
  GetArticle(url, done, fail, always, isGallery = false) {
    const entities = isGallery ? 'entities{description title asset{url}}' : '';
    const key = Model.GetKey(url);
    const data = Storages.localStorage.get(key);
	if (data) {
      done(data);
	  always(data);
	  return {abort: function(){}};
	}
	else {
      return $.get(
        this.baseUrl + `/https://mobileapi.wp.pl/v1/graphql?query={article(url:"${url}"){url t title ts img{url h w}body(t:[Plain,HTML,Video]){data}${entities}}}`,
		payload => done(Storages.localStorage.set(key, payload.data.article)),
        'json')
		  .fail(fail)
          .always(always);
	}
  }
  
  GetVideoData(url, done, fail, always) {
    let key = Model.GetKey(url);
    let data = Storages.sessionStorage.get(key);
	if (data) {
      done(data);
	  always(data);
	  return {abort: function(){}};
	}
	else {
      return $.get(
        this.baseUrl + `/${url}`,
		payload => done(Storages.sessionStorage.set(key, payload)),
        'json')
          .fail(fail)
		  .always(always);
	}
  }
	  
  /// returns the requested number of articles following the one of the given url
  async DownloadArticles(limit = this.limit, lastUrl, queryOffset, emptyResultsNo = 0) {
    if (limit < 1) {
      return []; }
	
    let queryLimit = this.buffer;
	if (queryOffset || (queryOffset = this.taken)) {
	  queryOffset--;
      queryLimit++; }
	if (!lastUrl && this.storage[0].length) {
      lastUrl = this.storage[0][this.storage[0].length - 1].url; }

	let articles = (await $.get({
        url: this.baseUrl + `/https://mobileapi.wp.pl/v1/graphql?query={articles(t:[Article,External,Video,Gallery],limit:${queryLimit},offset:${queryOffset}){url ts t title tags img{url}}}`,
	    dataType: 'json'})
	      ).data.articles;

	if (lastUrl) {
	  const lastUrlIndex = articles.findIndex(item => lastUrl === item.url);
	  // 'index' greather than 0 accounts for new articles published in the meantime
	  const index = lastUrlIndex > -1 ? lastUrlIndex : articles.length;
	  this.taken += index;
	  queryOffset += index + 1;
	  articles = articles.slice(index + 1); }
	
	articles = articles.slice(0, limit);
	const count = articles.length;
	queryOffset += count;
	if (!count) {
      if (++emptyResultsNo > this.maxEmptyResultsNo) {
        Storages.localStorage.remove('articles');
        return []; }
	  var rest = await this.DownloadArticles(limit, lastUrl, queryOffset, emptyResultsNo); }
	else {
      var rest = await this.DownloadArticles(limit - count, articles[count - 1].url, queryOffset); }

    return [...articles, ...rest];
  }
	  
  *[Symbol.iterator](limit = this.limit) {
    let remaining = yield* this.CurrentBucket(limit); // exhousting current bucket
	this.taken += limit - remaining;
	
    if (remaining) { // current bucket depleted
	  let results;
	  const firstUrl = this.storage[1] && this.storage[1][0] && this.storage[1][0].url;
	  yield this.DownloadArticles(this.online ? remaining : 0)
	    .catch(() => { this.online = false; return []; })
		.then(articles => {
		  // check whether the first payload article to return is in the current bucket already <- sibling, continuous buckets or refresh without new articles
		  if (firstUrl && (!articles.length || firstUrl === articles[0].url)) {
			  this.currentBucket = true;
			  return this.storage[1].shift();
		  }
		  else if (!articles.length) {
			  throw { message: this.NoDataError };
		  }
		  
	      results = articles.slice(1);
	      return articles[0]; });
	  
	  let i = 1, item;
	  // yielding from the payload reminder
	  if (results) {
	    for (; i < remaining && (item = results.shift()); i++) {
          if (firstUrl && firstUrl === item.url) { // hitting the current bucket
		    this.currentBucket = true;
  		    yield this.storage[1].shift();
		    i++;
		    break;
		  }

		  yield item; }}
	  
	  this.taken += i;
	  if (remaining -= i) {
        yield* this[Symbol.iterator](remaining);
      }}}
  
  static GetKey(url) {
    return url.replace(/\./g,'+');
  }
  
  *CurrentBucket(limit) {
	if (!this.currentBucket || !this.storage[1]) {
      return limit;
	}
	
    for (var i = 0, value; i < limit && (value = this.storage[1].shift()); i++) {
	  yield value;
	}
	if (!this.storage[1].length) {
	  this.currentBucket = false;
      this.storage.splice(1, 1); // remove current bucket (induces shifting to the next one)
	}
	return limit - i;
  }
  
}
