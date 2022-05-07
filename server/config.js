module.exports = {
    port: 9124,

    validateUsername: username => !(!username || username.length > 16 || !/[A-Za-z0-9_]/g.test(username))
};
