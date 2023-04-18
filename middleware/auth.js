const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  if (req.method === "OPTIONS") {
    return next();
  }
  try {
    const token = req.headers.authorization.split(" ")[1];
    if (!token) {
      throw new Error("Authentication Failed!");
    }
    // try { jwt.verify(token, "your secret",  req.user = decode; return next(); // !important, you need this here to run. }); } catch (err) { return res.status(500).send({ message: err.message }); }
    jwt.verify(token, process.env.JWT_KEY, (err, decodedToken) => {
      if (err) {
        return res.status(401).json({ message: err.message });
      }
      req.userData = { userId: decodedToken.userId, role: decodedToken.role, username: decodedToken.username };
      return next();
    });
    // if (decodedToken) {
    //   req.userData = { userId: decodedToken.userId, role: decodedToken.role };
    //   next();
    // } else {
    //   return res.status(403).json({ message: "Authorization Failed!" });
    // }
  } catch (err) {
    return res.status(401).json({ message: "Authentication Failed!" });
  }
};
