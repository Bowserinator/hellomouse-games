module.exports = {
    port: 1337,

    validateUsername: username => !(!username || username.length > 16 || !/[A-Za-z0-9_]/g.test(username))
};
