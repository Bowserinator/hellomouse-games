module.exports = {
    port: 8124,
    https: false, // TODO client stuff

    validateUsername: (username:string) => !(!username || username.length > 16 || !/[A-Za-z0-9_]/g.test(username))
};
