export default {
    port: 8124,
    https: false,

    validateUsername: (username:string) => !(!username || username.length > 16 || !/[A-Za-z0-9_]/g.test(username))
};
