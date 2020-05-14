/**
 * Web worker to asynchronously pull and cache data from the network
 * per session. Will cache requests/responses up to the specified
 * CACHE_PAGE_LIMIT each session, page refresh, or sort/filter change. 
 * If request/response is not found in cache, then it will fallback to 
 * fetching from the network as normal.
 * 
 * Cache clears any time filter or sort properties change, or whenever
 * the user refreshes the page or starts a new session. Since, the
 * api normally accepts POST requests, which can't be cached by the
 * CACHE API, a separate GET request is created to store responses.
 */

const CACHE_NAME = "spmTrackerCache";
const CACHE_PAGE_LIMIT = 500;

let isSynced = false;
let isCacheCleared = false;
let isCacheAvailable = "caches" in self;
let prevSortFilterProps = {};
let sortFilterProps = {};

/**
 * Used to create unique url queries for caching. Counter doesn't 
 * accurately create ordered number of keys, but it's enough to create 
 * unique params for cache key matching.
 * @param {Object} object - Object to flatten.
 * @param {Number} counter - Counter for duplicate keys.
 * @returns {Object}
 */
const flattenObject = (object, counter = 0) => {
  if (typeof object !== "object") {
    throw new Error("Parameter passed not an object.");
  }

  let flattenedObject = Object.keys(object).reduce((acc, key) => {
    if (key === "compare") {
      return acc;
    }

    if (typeof object[key] === "object") {
      acc = {...acc ,...flattenObject(object[key], ++counter)
      };
    } else {
      let affix = counter ? counter : "";
      acc[key + affix] = object[key];
    }

    return acc;
  }, {});

  return flattenedObject;
};

/**
 * Convert object into a url query string.
 * @param {Object} object - Object to convert to query string.
 * @returns {String}
 */


/**
 * Returns GET/POST request with optional body properties.
 * @param {String} url - API url to fetch data from.
 * @param {String} type - Request method: "POST" or "GET"
 * @param {Object} body - Request body contents.
 * @returns {Request}
 */
const createRequest = (url, type, body = {}) => {
	//console.log(body);
  let request = {
    url,
    options: {
      method: type,
      headers: {
        "Content-Type": "application/json"
      }
    }
  };

  if (type.toLowerCase() === "get") {
    let queryBody = "";

    for (let property in body) {
    	
        if (typeof body[property] === "object") {
			if (property === 'sort') {
				
			}
          queryBody += objectToParamsString(flattenObject(body[property]));
        } else {
          queryBody += `&${property}=${body[property]}`;
        }
      }

   let params = new URLSearchParams(queryBody.slice(1));

   request.url += `?${params.toString()}`;
  } 
 

  return new Request(request.url, request.options);
};

/**
 * Fetch data from the API or cache.
 * @param {Event.data} eventData - Data passed from PostMessage.
 * @returns {JSON}
 */
const pullData = async (eventData) => {
	console.log(eventData);
    const { url, ...restOfData} = eventData;
    const cacheRequest = createRequest(url, "GET", restOfData);
   const networkRequest = createRequest(url, "POST", restOfData);
    const cache = await caches.open(CACHE_NAME);

    let response = await fetch(cacheRequest);

   if (!response) {
      response = await fetch(cacheRequest);

     let cacheResponse = response.clone();

    if (restOfData.page <= CACHE_PAGE_LIMIT) {
       cache.put(cacheRequest, cacheResponse);
    }
   }

     return response.json();
  };


/**
 * Updates a cached request.
 * @param {Request} request - GET request.
 * @param {Response} response - Response object.
 */
  const updateCache = async (request, response) => {
  try {
    const { url, method, ...resOfRequest} = request;
    const cache = await caches.open(CACHE_NAME);

    const cacheRequest =
      method.toLowerCase() === "get"
        ? createRequest(request.url, "GET", resOfRequest)
        : request;

    const isCached = await cache.match(cacheRequest);

    if (isCached) cache.put(request, response);
  } catch (error) {
    throw new Error("Error updating cache:");
  }
};

/**
 * Fetches pages from the API and caches them.
 * @param {Event.data} eventData - Data passed from postMessage.
 * @param {Object} pageSlice - { start: Number, end: Number } Pages to sync.
 */
const backgroundSync = async (eventData, { start = 1, end } = pageSlice) => {
  if (start > end) return;

  let _eventData = Object.assign({}, eventData, { page: start });

  await (pullData(_eventData));

  backgroundSync(_eventData, { start: ++start, end });
};

/**
 * Executes before backgroundSync. Finds and deletes CACHE_NAME from
 * browser cache. We don't care about persistence, only about fetching
 * data asynchronously during the session.
 * @returns {Promise}
 */
const clearCache = async () => {
  try {
    let cacheKeys = await caches.keys();

    return Promise.all(
      cacheKeys.map(cacheKey => {
        if (cacheKey === CACHE_NAME) return caches.delete(cacheKey);
      })
    );
  } catch (error) {
    console.log('Error trying to clear');
  }
};

/**
 * Quick utility function to deep clone object properties. Not sure if it
 * catches everything, but seems enough to at least deep clone sort and
 * filter objects.
 * @param {Object} object - Object to deep clone.
 * @returns {Object}
 */
const deepClone = object => {
  let clonedObject = Array.isArray(object) ? [] : {};

  for (let property in object) {
    if (typeof object[property] === "object") {
      clonedObject[property] = deepClone(object[property]);
    } else {
      clonedObject[property] = object[property];
    }
  }

  return clonedObject;
};

/**
 * Utility function to compare values of objects. Use to detect changes
 * to sort and filter properties.
 * @param {Object} object1 - Object to compare.
 * @param {Object} object2 - Object to compare.
 * @returns {Boolean}
 */
const compare = (object1, object2) => {
  if (
    typeof object1 !== "object" ||
    typeof object2 !== "object" ||
    Object.keys(object1).length !== Object.keys(object2).length
  ) {
    return false;
  }

  for (let key in object1) {
    if (!object2.hasOwnProperty(key)) {
      return false;
    }

    if (typeof object1[key] === "object" || typeof object2[key] === "object") {
      if (!compare(object1[key], object2[key])) {
        return false;
      }
    } else if (!Object.is(object1[key], object2[key])) {
      return false;
    }
  }

  return true;
};

/**
 * Worker scope method. Will delete old cache and sync new cache on
 * first postMessage received.
 */
onmessage = async (event) => {

//    if (!isCacheAvailable) {
//      console.log("Your browser doesn't support the cache API.");
//      return;
//    }
    const { url, page, pageSize, sort, filter } = event.data;
	let eventData = { url, page, pageSize};
	
    if (sort){
		sortFilterProps.sort = sort;
		console.log('Reloading pages...')
	}
    if (filter) {
		sortFilterProps.filter = filter;
		console.log('Reloading pages...')
	}

    eventData = {...eventData};

   if (!compare(prevSortFilterProps, sortFilterProps)) {
      prevSortFilterProps = deepClone(sortFilterProps);
      isCacheCleared = false;
     isSynced = false;
   }
    if (!isCacheCleared) {
     await clearCache();
     isCacheCleared = true;
    }

    let data = await (pullData(eventData));

    if (!isSynced) {
      let pageCount = data.length / pageSize;

      if (isNaN(pageCount)) {
        throw new Error("Error determining number of pages. pageCount isNaN.");
      }

      if (pageCount > CACHE_PAGE_LIMIT) {
        pageCount = CACHE_PAGE_LIMIT;
      }

      isSynced = true;

      backgroundSync(eventData, { end: pageCount });
    }

    postMessage(data);
  
};
