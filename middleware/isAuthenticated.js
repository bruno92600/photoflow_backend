const jwt = require("jsonwebtoken");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/appError");
const User = require("../models/userModel");

const isAuthenticated = catchAsync(async (req, res, next) => {
  const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
  if (!token) {
    return next(
      new AppError(
        "Vous devez vous authentifier pour accéder à cette page!",
        401
      )
    );
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const currentUser = await User.findById(decoded.id);
  if (!currentUser) 
    return next(
      new AppError("L'utilisateur appartenant à ce token n'existe pas", 401)
    );
    req.user = currentUser;
    next();
});

module.exports = isAuthenticated;
