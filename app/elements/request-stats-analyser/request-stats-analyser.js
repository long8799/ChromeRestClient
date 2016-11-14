(function() {
  'use strict';
  /**
   * The request history analyser.
   * It takes all available history data for given URL and HTTP method and computes
   * stats for this request.
   */
  Polymer({
    is: 'request-stats-analyser',

    properties: {
      url: String,
      method: String,
      request: Object,
      response: Object,
      analysing: {
        type: Boolean,
        readOnly: true,
        notify: true
      },
      /**
       * A map of calculated medians.
       * - totalTime - Median for request total time
       * - sentTime - Median for sending time
       * - ttfb
       * - receivingTime
       * - connectTime
       * - requestBody - Median for request body size
       * - requestHeaders - Median for request headers size
       * - responseBody - Median for response body size
       * - responseHeaders - Median for response headers size
       */
      medians: {
        type: Object,
        notify: true,
        value: function() {
          return {};
        }
      },
      /**
       * Map of time related data.
       * Data are sorted according to object's created property.
       * - totals - List of total load times
       * - ttfb - List of time to first byte times
       * - sents - List of sent message times
       * - receiveds - List of time to receive message times
       * - connects - List of connection times
       * - labels - chart labels for data. Labets are dates and time strings.
       */
      times: {
        type: Object,
        notify: true,
        value: function() {
          return {};
        }
      },
      /**
       * Map of calculated data sizes transmited from / to client.
       * It contains two properties: request and response.
       * Both properties contains:
       * - body - List of sizes of payload
       * - headers - List of sizes of headers
       * - bLabels - Payload lables for charts
       * - hLabels - Headers lables for charts
       */
      sizes: {
        type: Object,
        notify: true,
        value: function() {
          return {
            request: {},
            response: {}
          };
        }
      },
      // Status codes in `labels` array and number of occurence in `values` array
      statuses: {
        type: Object,
        notify: true,
        value: function() {
          return {
            labels: [],
            values: []
          };
        }
      },
      /**
       * Flags to tell if data has values.
       * Object structure is combined `times` and `sizes` into one object (with this
       * property names as keys) but value is a Boolean determinig if given position has data.
       */
      presence: {
        type: Object,
        notify: true,
        value: function() {
          return {
            times: {
              totals: false
            },
            sizes: {
              request: {
                body: false,
                headers: false
              },
              response: {
                body: false,
                headers: false
              }
            }
          };
        }
      },
      // True if after computation any data are set.
      hasAnyData: {
        type: Boolean,
        notify: true,
        value: false,
        computed: '_hasAnyData(presence.times.totals, presence.sizes.request.body, ' +
          'presence.sizes.request.headers, presence.sizes.response.body, ' +
          'presence.sizes.response.headers)'
      }
    },

    observers: [
      '_autoAnalyseData(url, method)',
      '_responseChanged(response.*)'
    ],

    _hasArrayData: function(arr) {
      return !!(arr.base && arr.base.length);
    },

    _hasAnyData: function() {
      // debugger;
      var t = Array.from(arguments);
      return t.some((i) => i === true);
    },

    _autoAnalyseData: function(a, b) {
      this.debounce('history-analyser', () => {
        this.analyseData(a, b);
      }, 1000);
    },

    clear: function() {
      this.set('medians', {});
      this.set('times', {});
      this.set('sizes', {
        request: {},
        response: {}
      });
      this.set('statuses', {
        labels: [],
        values: []
      });
      this.set('presence', {
        times: {
          totals: false
        },
        sizes: {
          request: {
            body: false,
            headers: false
          },
          response: {
            body: false,
            headers: false
          }
        }
      });
    },

    analyseData: function(url, method) {
      url = url || this.url;
      method = method || this.method;
      if (!url || !method) {
        this.clear();
        return;
      }
      this._setAnalysing(true);
      let uri;
      try {
        uri = new URL(url);
        uri.search = '';
        uri.hash = '';
        uri = uri.toString();
      } catch (e) {
        let i = url.indexOf('?');
        if (i !== -1) {
          uri = url.substr(0, i);
        } else {
          uri = url;
        }
      }
      // if (uri[uri.length - 1] === '/') {
      //   uri = uri.substr(0, uri.length - 1);
      // }
      // console.log('Running worker for ', url, method);
      this.startTime = performance.now();
      this._getHistoryData(uri, method);
    },
    // Creates a worker (if needed) and gets data from the indexedDB.
    _getHistoryData: function(url, method) {

      var post = {
        url: url,
        method: method
      };
      if (this._collectorWorker) {
        return this._collectorWorker.postMessage(post);
      }
      var blob = new Blob([this.$.dataCollectionWorker.textContent]);
      this._collectorWorkerUrl = window.URL.createObjectURL(blob);
      this._collectorWorker = new Worker(this._collectorWorkerUrl);
      this._collectorWorker.onmessage = this._processCollectorData.bind(this);
      this._collectorWorker.onerror = this._processCollectorError.bind(this);
      this._collectorWorker.postMessage(post);
    },
    // Process data returned from the collector worker.
    _processCollectorData: function(e) {
      console.info('Data collection time: ', e.data.time);
      var list = e.data.data;
      if (!list || !list.length) {
        this._setAnalysing(false);
        this.clear();
        console.info('No data found');
        return;
      }
      this._processRawData(list);

    },
    // Collector worker error ocurred.
    _processCollectorError: function(e) {
      this.fire('app-log', {
        level: 'error',
        message: ['Collecting history data error', e]
      });
      this._setAnalysing(false);
      this.fire('send-analytics', {
        type: 'exception',
        description: e.message,
        fatal: false
      });
      this.clear();
    },
    // Process raw history data
    _processRawData: function(docs) {
      if (this._worker) {
        return this._worker.postMessage(docs);
      }
      var blob = new Blob([this.$.worker.textContent]);
      this._workerUrl = window.URL.createObjectURL(blob);
      this._worker = new Worker(this._workerUrl);
      this._worker.onmessage = this._processAnalysedData.bind(this);
      this._worker.onerror = this._processAnalyserError.bind(this);
      this._worker.postMessage(docs);
    },
    // Process data that has been already analysed
    _processAnalysedData: function(e) {
      var data = e.data;
      this.set('medians', data.medians);
      this.set('times', data.times);
      this.set('sizes', data.sizes);
      this.set('statuses', data.statuses);
      this.set('presence', data.presence);
      this._setAnalysing(false);
      this.fire('request-stats-analysed');

      var execTime = performance.now() - this.startTime;
      console.info('Processing history data time', execTime);

      this.fire('send-analytics', {
        type: 'timing',
        category: 'History assistant',
        variable: 'Analysing history',
        value: execTime
      });
    },
    // There was an error in data analyser.
    _processAnalyserError: function(e) {
      this.fire('app-log', {
        level: 'error',
        message: ['Analysing history data error', e]
      });
      this._setAnalysing(false);
      this.clear();
    },
    /**
     * Calculate a median from the array of numbers.
     */
    calculateMedian: function(arr) {
      if (!arr || arr.length === 0) {
        return 0;
      }
      if (arr.length === 1) {
        return Math.round(arr[0]);
      }
      var copy = arr.slice(0).sort(function(a, b) {
        return a - b;
      });
      var half = Math.floor(copy.length / 2);
      if (copy.length % 2 === 0) {
        // If there is an even number of results,
        // the median will be the mean of the two central numbers.
        return Math.round((copy[half - 1] + copy[half]) / 2.0);
      }
      // If there is an odd number of results, the median is the middle number.
      return Math.round(copy[half]);
    },

    _responseChanged: function() {
      if (!this.response || !this.response.stats) {
        // not ready.
        return;
      }
      this._setAnalysing(true);
      var cp = Object.assign({}, this.response);
      delete cp._headers;
      delete cp._body;
      delete cp.ok;
      delete cp.redirects;
      delete cp.statusText;
      var post = {
        request: {
          headers: this.request.headers,
          payload: this.request.payload
        },
        response: cp
      };
      if (this._responseWorker) {
        return this._responseWorker.postMessage(post);
      }
      var blob = new Blob([this.$.responseProcess.textContent]);
      this._responseWorkerUrl = window.URL.createObjectURL(blob);
      this._responseWorker = new Worker(this._responseWorkerUrl);
      this._responseWorker.onmessage = this._processResponseWorkerData.bind(this);
      this._responseWorker.postMessage(post);
    },

    _processResponseWorkerData: function(e) {
      var data = e.data;
      if (!this.times.labels) {
        this.times.labels = [];
      }
      if (!this.times.totals) {
        this.times.totals = [];
      }
      if (!this.times.ttfb) {
        this.times.ttfb = [];
      }
      if (!this.times.connects) {
        this.times.connects = [];
      }
      if (!this.times.receiveds) {
        this.times.receiveds = [];
      }
      if (!this.times.sents) {
        this.times.sents = [];
      }
      if (!this.times.ssl) {
        this.times.ssl = [];
      }
      if (!this.sizes.request) {
        this.sizes.request = {
          hLabels: [],
          headers: [],
          bLabels: [],
          body: []
        };
      }
      if (!this.sizes.response) {
        this.sizes.response = {
          hLabels: [],
          headers: [],
          bLabels: [],
          body: []
        };
      }
      if (!this.sizes.request.headers || !this.sizes.request.headers.length ||
          !this.sizes.request.hLabels || !this.sizes.request.headers.hLabels) {
        this.sizes.request.hLabels =  [];
        this.sizes.request.headers = [];
      }
      if (!this.sizes.request.body || !this.sizes.request.body.length ||
          !this.sizes.request.bLabels || !this.sizes.request.bLabels.length) {
        this.sizes.request.bLabels =  [];
        this.sizes.request.body = [];
      }
      if (!this.sizes.response.headers || !this.sizes.response.headers.length ||
          !this.sizes.response.hLabels || !this.sizes.response.hLabels.length) {
        this.sizes.response.hLabels =  [];
        this.sizes.response.headers = [];
      }
      if (!this.sizes.response.body || !this.sizes.response.body.length ||
          !this.sizes.response.bLabels || !this.sizes.response.bLabels.length) {
        this.sizes.response.bLabels =  [];
        this.sizes.response.body = [];
      }
      this.push('times.labels', data.times.label);
      this.push('times.totals', data.times.total);
      this.push('times.ttfb', data.times.ttfb);
      this.push('times.connects', data.times.connect);
      this.push('times.receiveds', data.times.received);
      this.push('times.sents', data.times.sent);
      if (data.times.ssl && (data.times.ssl > -1 || (this.time.ssl && this.time.ssl.length))) {
        if (data.times.ssl === -1) {
          data.times.ssl = 0;
        }
        this.push('times.ssl', data.times.ssl);
      }

      if (data.sizes.request.headers) {
        this.push('sizes.request.hLabels', data.sizes.request.hLabel);
        this.push('sizes.request.headers', data.sizes.request.headers);
      }
      if (data.sizes.request.body) {
        this.push('sizes.request.bLabels', data.sizes.request.bLabel);
        this.push('sizes.request.body', data.sizes.request.body);
      }
      if (data.sizes.response.headers) {
        this.push('sizes.response.hLabels', data.sizes.response.hLabel);
        this.push('sizes.response.headers', data.sizes.response.headers);
      }
      if (data.sizes.response.body) {
        this.push('sizes.response.bLabels', data.sizes.response.bLabel);
        this.push('sizes.response.body', data.sizes.response.body);
      }

      this.set('medians.total', this.calculateMedian(this.times.totals));
      this.set('medians.ttfb', this.calculateMedian(this.times.ttfb));
      this.set('medians.sent', this.calculateMedian(this.times.sents));
      this.set('medians.receiving', this.calculateMedian(this.times.receiveds));
      this.set('medians.connect', this.calculateMedian(this.times.connects));
      this.set('medians.ssl', this.calculateMedian(this.times.ssl));
      this.set('medians.requestBody', this.calculateMedian(this.sizes.request.body));
      this.set('medians.requestHeaders', this.calculateMedian(this.sizes.request.headers));
      this.set('medians.responseBody', this.calculateMedian(this.sizes.response.body));
      this.set('medians.responseHeaders', this.calculateMedian(this.sizes.response.headers));

      if (!this.statuses.labels || !this.statuses.labels.length) {
        this.statuses = {
          labels: [],
          values: []
        };
      }
      if (!this.statuses) {
        this.statuses = {
          labels: [],
          values: []
        };
      }
      var currentCode = String(this.response.status);
      var statusIndex = this.statuses.labels.findIndex((i) => i === currentCode);
      if (statusIndex === -1) {
        this.push('statuses.labels', currentCode);
        this.push('statuses.values', 1);
      } else {
        let cnt = this.statuses.values[statusIndex];
        this.set('statuses.values.' + statusIndex, ++cnt);
      }

      this.set('presence', {
        times: {
          totals: !!(this.times.totals && this.times.totals.length),
          ttfb: !!(this.times.ttfb && this.times.ttfb.length),
          sents: !!(this.times.sents && this.times.sents.length),
          receiveds: !!(this.times.receiveds && this.times.receiveds.length),
          connects: !!(this.times.connects && this.times.connects.length),
          labels: !!(this.times.labels && this.times.labels.length),
          ssl: !!(this.times.ssl && this.times.ssl.length),
        },
        sizes: {
          request: {
            body: !!(this.sizes.request.body && this.sizes.request.body.length),
            headers: !!(this.sizes.request.headers && this.sizes.request.headers.length)
          },
          response: {
            body: !!(this.sizes.response.body && this.sizes.response.body.length),
            headers: !!(this.sizes.response.headers && this.sizes.response.headers.length)
          }
        },
        statuses: !!(this.statuses.labels && this.statuses.labels.length)
      });

      this._setAnalysing(false);
      this.fire('request-stats-analysed');
    }
  });
})();