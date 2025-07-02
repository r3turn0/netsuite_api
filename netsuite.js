const netsuiteApiClient = require('netsuite-api-client');

class NetsuiteApi {
    constructor(credentials) {
        this.client = new netsuiteApiClient({
            consumer_key: credentials.consumer_key,
            consumer_secret_key: credentials.consumer_secret_key,
            token: credentials.token,
            token_secret: credentials.token_secret,
            realm: credentials.realm,
            base_url: credentials.base_url
        })
    }
    get(p) {
        return new Promise((resolve, reject) => {
            (async (path) => {
                try {
                    const response = await this.client.request({ path });
                    resolve(response.data);
                } catch (err) {
                    reject(err);
                } 
            })(p);
        });
    }
    query(s, l, o) {
        return new Promise((resolve, reject) => {
            (async (query, limit, offset) => {
                try {
                    const transactions = await this.client.query(query, limit, offset);
                    resolve(transactions);
                }
                catch(err) {
                    reject(err);
                }
            })(s,l,o);
        });
    }
    queryAll(q, l) {
        const items = [];
        return new Promise((resolve, reject) => {
            (async (query, limit) => {
                try {
                    const transactions = await this.client.queryAll(query, limit);
                    transactions.on('data', (data)  => {
                        items.push(data);
                    }).on('end', () => {
                        resolve(items);
                    }).on('error', (err) => {
                        reject(err);
                    });
                }
                catch(err) {
                    reject(err);
                }
            })(q, l);
        });
    }
}

module.exports = NetsuiteApi