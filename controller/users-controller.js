const { validationResult } = require("express-validator");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const Event = require("../models/event");

const { isValidObjectId } = require("mongoose");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const Bill = require("../models/bill");
const Category = require("../models/category");

const User = require("../models/users");
const VerificationToken = require("../models/verificationToken");
const ResetToken = require("../models/resetToken");
dotenv.config();

const connection = mongoose.connection;

const {
  transporter,
  verifyEmailTemplate,
  forgotEmailTemplate,
  passwordSetTemplate,
  verifiedTemplate,
} = require("../util/email");

let gfs;

let bucket;
connection.once("open", () => {
  bucket = new mongoose.mongo.GridFSBucket(connection, {
    bucketName: "resources",
    chunkSizeBytes: 1048576,
  });
});

const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

let environment = process.env.NODE_ENV;
let url;

if (environment === "development") {
  url = "http://localhost:3000";
} else {
  url = "http://portal.anstesters.com";
}

const signup = async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const message = errors.errors[0].msg;
    return res.status(400).json({ message: message });
  }

  const {
    first_name,
    last_name,
    email,
    phone_number,
    password,
    confirm_password,
    employer,
    dob,
    address,
    years_of_exp,
    membership_type,
  } = req.body;
  let existingUser;
  try {
    existingUser = await User.findOne({ email: email });
  } catch (err) {
    return res.status(500).json({ message: " Signing Up Failed" });
  }

  if (existingUser) {
    return res.status(422).json({ message: "User Already Exist" });
  }
  // let hashedPassword;
  // try {
  //   hashedPassword = await bcrypt.hash(password, 12);
  // } catch (err) {
  //   return res
  //     .status(422)
  //     .json({ message: "Couldn't create User, Please Try Again", e: err });
  // }
  // let confirmStatus;
  // license_status === "Unlicensed"
  //   ? (confirmStatus = null)
  //   : (confirmStatus = regulator);

  const user = User({
    first_name,
    last_name,
    email,
    phone_number,
    password,
    employer,
    dob,
    address,
    years_of_exp,
    membership_type,
  });

  user
    .save()
    .then((user) => {
      const randomBytes = crypto.randomBytes(16).toString("hex");

      const token = VerificationToken({
        userId: user._id,
        token: randomBytes,
      });

      token.save().then(async () => {
        const emailLink = `${url}/email-verification?email=${user.email}&token=${randomBytes}`;
        const mailOptions = verifyEmailTemplate(user, emailLink);

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            return res
              .status(500)
              .json({ message: "Error sending email", error });
          } else {
            return res.status(201).json({
              message: `${user.first_name} ${user.last_name} a confirmation email has been sent to ${user.email}`,
            });
          }
        });
      });
    })
    .catch((e) => {
      return res.status(500).json({
        message: "Couldn't create User, Please Try Again",

        error: e,
      });
    });
};

//Login

const login = async (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const message = errors.errors[0].msg;
    return res.status(400).json({ message: message });
  }
  const { email, password } = req.body;
  let existingUser;
  try {
    existingUser = await User.findOne({ email: email });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Login failed , please try again " });
  }

  if (!existingUser) {
    return res
      .status(404)
      .json({ message: "Invalid Credentials, could not log you in" });
  }

  let isValidPassword = false;
  try {
    isValidPassword = await existingUser.comparePassword(password);
  } catch (err) {
    return res
      .status(500)
      .json({
        message: "Something went wrong, could not log you in. Please try again",
      });
  }

  if (!isValidPassword) {
    return res
      .status(403)
      .json({ message: "Invalid Credentials, could not log you in" });
  }
  if (!existingUser.isVerified) {
    return res
      .status(403)
      .json({ message: "Please Verify your email then Login" });
  }

  const name = `${existingUser.first_name} ${existingUser.last_name}`;
  let token;
  try {
    token = jwt.sign(
      {
        userId: existingUser.id,
        role: existingUser.role,
        username: name,
      },
      process.env.JWT_KEY
    );
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Logging Failed, Please try again" });
  }

  return res.status(202).json({
    message: `Login Sucessful`,
    userObject: { userId: existingUser.id, role: existingUser.role },
    token: token,
  });
};

// Verification of Email
const verifyEmail = async (req, res) => {
  let check;
  try {
    check = await User.findOne({
      email: req.query.email,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Verification Of Email Failed. Please Try again",
    });
  }
  if (check.isVerified)
    return res.json({
      message: "User has already been verified, Please Login ",
    });

  let existingUser;
  let token;
  try {
    token = await VerificationToken.findOne({ token: req.query.token });
  } catch (err) {
    return res
      .status(500)
      .json({ message: " Verification Of Email Failed. Please Try again" });
  }

  if (!token)
    return res.status(403).json({
      message:
        "Your verification link may have expired. Please click on resend for verify your Email ",
    });

  try {
    existingUser = await User.findOne({
      _id: token.userId.toString(),
      email: req.query.email,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Verification Of Email Failed. Please Try again",
    });
  }

  if (!existingUser) {
    return res.status(404).json({
      message: "User not found. ",
    });
  } else if (existingUser.isVerified) {
    await VerificationToken.findByIdAndDelete(token._id);

    return res.json({
      message: "User has already been verified. ",
    });
  } else {
    existingUser.isVerified = true;
    await VerificationToken.findByIdAndDelete(token._id);
    existingUser
      .save()
      .then((user) => {
        const mailOptions = verifiedTemplate(user);
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            return res
              .status(500)
              .json({ message: "Error sending email", error });
          }
          // } else {
          //   return res.status(201).json({
          //     message: `${user.first_name} ${user.last_name} a verification email has been sent to ${user.email}`,

          //   });
          // }
        });
        return res.status(200).json({
          message: `${user.first_name} ${user.last_name}, You have sucessfully verified your email, you can login.`,
        });
      })
      .catch((e) => {
        res.status(500).json({ message: "Verification Of Email Failed" });
      });
  }
};

const resendLink = async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const message = errors.errors[0].msg;
    return res.status(400).json({ message: message });
  }
  let user;
  try {
    user = await User.findOne({ email: req.body.email });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }

  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.isVerified)
    return res.status(203).json({
      message: "This Account has already been verified, Please Log in",
    });

  const randomBytes = crypto.randomBytes(16).toString("hex");

  const token = VerificationToken({
    userId: user._id,
    token: randomBytes,
  });

  token
    .save()
    .then(() => {
      const emailLink = `${url}/email-verification?email=${user.email}&token=${randomBytes}`;
      const mailOptions = verifyEmailTemplate(user, emailLink);

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          return res
            .status(500)
            .json({ message: "Error sending email", error });
        } else {
          return res.status(200).json({
            message: `${user.first_name} ${user.last_name} a verification email has been sent to ${user.email}`,
          });
        }
      });
    })
    .catch((e) => {
      return res
        .status(500)
        .json({ message: "Couldn't create User, Please Try Again", error: e });
    });
};

const forgotPassword = async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const message = errors.errors[0].msg;
    return res.status(400).json({ message: message });
  }
  const email = req.body.email;
  let user;
  let token = crypto.randomBytes(16).toString("hex");

  try {
    user = await User.findOne({ email });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
  if (!user) {
    return res.status(404).json({ message: "User does not exist" });
  }

  const oldToken = await ResetToken.findOne({ userId: user.id });
  if (oldToken) await oldToken.deleteOne();

  const resetToken = ResetToken({ userId: user.id, token: token });

  resetToken
    .save()
    .then(() => {
      const resetLink = `${url}/reset-password?userId=${user.id}&token=${token}`;
      const mailOptions = forgotEmailTemplate(user, resetLink);

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          return res
            .status(500)
            .json({ message: "Error sending email", error });
        } else {
          return res.status(201).json({
            message: `A password reset email has been sent to ${user.email}`,
          });
        }
      });
    })

    .catch((e) => {
      return res.status(500).json({ message: "Couldn't save User ", error: e });
    });
};

const resetPassword = async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const message = errors.errors[0].msg;
    return res.status(404).json({ message: message });
  }
  let user;

  const newPassword = req.body.password;

  try {
    user = await User.findOne(req.user._id);
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const samePass = await user.comparePassword(newPassword);
  if (samePass)
    return res.status(403).json({
      message: `New Password must be different`,
    });

  user.password = newPassword.trim();

  user
    .save()
    .then((user) => {
      ResetToken.findOneAndDelete({ userId: user.id }).then(() => {
        const mailOptions = passwordSetTemplate(user);
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            return res
              .status(500)
              .json({ message: "Error sending email", error });
          } else {
            return res.status(200).json({
              message: `${user.first_name} ${user.last_name} your password has been reset sucessfully`,
            });
          }
        });
      });
    })
    .catch((e) => {
      return res
        .status(500)
        .json({ message: "Couldn't Reset password", error: e });
    });
};

const getLoggedUser = (req, res) => {
  const userId = req.userData.userId;
  User.findById(
    userId,
    " first_name last_name address phone_number employer years_of_exp membership_type"
  )
    .then((user) => {
      if (!user) return res.status(404).json({ message: "No user found" });
      return res.status(200).json(user);
    })
    .catch(() => {
      return res
        .status(500)
        .json({ message: "Someting went wrong!.. please try again." });
    });
};

const editProfile = async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const message = errors.errors[0].msg;
    return res.status(400).json({ message: message });
  }
  const {
    first_name,
    last_name,
    phone_number,
    address,
    membership_type,
    employer,
    years_of_exp,
  } = req.body;

  let editedUser;
  try {
    editedUser = await User.findByIdAndUpdate(
      req.userData.userId,
      {
        $set: {
          first_name,
          last_name,
          phone_number,
          address,
          membership_type,
          employer,
          years_of_exp,
        },
      },
      { new: true }
    );
  } catch (err) {
    return res
      .status(500)
      .json({ message: " Something went Please try again" });
  }

  if (!editedUser) {
    return res.status(404).json({ message: "User does not exist" });
  }

  return res
    .status(201)
    .json({ message: " Your profile has been sucessfully edited" });
};

const getUploadedFiles = async (req, res) => {
  const cursor = bucket.find({});
  if (!cursor) return res.status(404).json({ message: "No file found" });
  const filesMetadata = await cursor.toArray();
  res.json(filesMetadata);
};

const getSingleFile = async (req, res) => {
  if (!isValidObjectId(req.params.id))
    return res.status(400).json({ message: "Invalid file-Id" });
  try {
    const _id = mongoose.Types.ObjectId(req.params.id);
    const cursor = bucket.find({ _id });
    const filesMetadata = await cursor.toArray();
    res.json(filesMetadata[0] || null);
  } catch (err) {
    res.status(500).json({ err: `Error: ${err.message}` });
  }
};

const preview = async (req, res) => {
  if (!isValidObjectId(req.params.id))
    return res.status(404).json({ message: "Invalid file-Id" });
  try {
    const _id = mongoose.Types.ObjectId(req.params.id);
    const cursor = bucket.find({ _id });
    const filesMetadata = await cursor.toArray();
    if (!filesMetadata.length) return res.json({ err: "Not a File!" });

    bucket.openDownloadStream(_id).pipe(res);
  } catch (err) {
    res.json({ err: `Error: ${err.message}` });
  }
};

const download = async (req, res) => {
  if (!isValidObjectId(req.params.id))
    return res.status(404).json({ message: "Invalid file-Id" });
 try {
    const _id = mongoose.Types.ObjectId(req.params.id);
    // Getting the file first is only a guard to avoid FileNotFound error
    const cursor = bucket.find({ _id });
    const filesMetadata = await cursor.toArray();

    if (!filesMetadata.length)
      return res.status(404).json({ err: "Not a File!" });
    // You can simply stream a file like this with its id
    let user;

    user = await User.findById(req.userData.userId);
    if (!user) return res.status(404).json({ message: "No user found" });
    console.log(filesMetadata[0].contentType);
    user.downloaded_files.push({
      filename: filesMetadata[0].filename,
      uploadDate: filesMetadata[0].uploadDate,
      contentType: filesMetadata[0].contentType,
    });
    user
      .save()
      .then(() => {
        const readStream = bucket.openDownloadStream(_id);
        res.set("Content-Type", `${filesMetadata[0].contentType}`);
        res.set(
          "Content-Disposition",
          `attachment; filename="${filesMetadata[0].filename}"`
        );

        readStream.pipe(res);
      })
      .catch((err) => {
        console.log(err);
        return res
          .status(401)
          .json({ message: "Something went wrong, please try again" });
      });
  } catch (err) {
    res.json({ err: `Error: ${err.message}` });
  }
};

const getDownloadedFiles = async (req, res) => {
  let user;
  try {
    user = await User.findById(req.userData.userId, "downloaded_files");
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }

  res.json(user);
};

const getNewBill = async (req, res) => {
  const filterFunc = (bill) => {
    const dateCreated = new Date(bill.createdAt);
    const expiredDate = new Date(
      dateCreated.getFullYear(),
      dateCreated.getMonth(),
      dateCreated.getDate() + 3
    );
    const currentDate = new Date();

    return (
      expiredDate > currentDate &&
      (bill.status === "unpaid" || bill.status === "dued")
    );
  };
  let user;
  try {
    user = await User.findById(req.userData.userId, "bills")
      .populate({
        path: "bills",
        select: "bill_name bill_amount status  createdAt",
      })
      .exec();
    const userBills = user.bills.filter((bill) => filterFunc(bill));
    res.json({
      user_id: user.id,
      user_bills: userBills,
    });
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};

const userBills = async (req, res) => {
  //  await User.findOne({ _id: req.userData.userId });
  let user;
  try {
    user = await User.findById(req.userData.userId, "bills")
      .populate({
        path: "bills",
        select: "bill_name bill_amount status createdAt",
      })
      .exec();
    res.json(user);
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};

const getCert = async (req, res) => {
  const user = await User.findById(req.userData.userId);

  try {
    const { id } = req.params;
    const bill = await Bill.findOne(
      { individual: user._id, bill_name: "annual membership certificate" },
      "individual status validUntil"
    ).populate({
      path: "individual",
      select: "first_name last_name membership_type ",
    });
    if (!bill) {
      return res.status(404).json({ error: "Bill not found" });
    }
    if (bill.status === "unpaid") {
      return res.status(400).json({ error: "Bill not paid" });
    }
    if (bill.validUntil < Date.now()) {
      return res.status(400).json({ error: "Certificate expired" });
    }
    if (!bill.name === "annual membership certificate") {
      return res
        .status(400)
        .json({ error: "You have not paid for certificate yet" });
    }

    const b = {
      name: `${bill.individual.first_name} ${bill.individual.last_name}`,
      validUntil: bill.validUntil,
      category: bill.individual.membership_type,
    };
    const pdf = await generateCertificate(b);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="membership_certificate.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

async function generateCertificate(user) {
  const doc = new PDFDocument();
  doc.fontSize(20).text("Membership Certificate");
  doc.fontSize(16).text(`Name: ${user.name}`);
  doc.fontSize(16).text(`Category: ${user.category}`);
  doc
    .fontSize(16)
    .text(`Valid until: ${new Date(user.validUntil).toLocaleDateString()}`);
  const pdfBuffer = await new Promise((resolve, reject) => {
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.end();
  });
  return pdfBuffer;
}

const pay = async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.userData.userId);

    if (!user) {
      return res.status(404).json({ message: "No user found" });
    }
    const bill = await Bill.findOne({
      _id: req.params.billId,
      individual: user._id,
    });
    if (!bill) {
      return res.status(404).json({ message: "No bill found" });
    }
    if (bill.status === "paid") {
      return res.status(400).json({ error: "Bill has already been paid" });
    }
    // Create Paystack payment request
    const { data } = await paystack.post("/transaction/initialize", {
      email: user.email,
      amount: amount * 100,
      metadata: {
        billId: bill.id,
      },
    });

    // Return payment URL to client
    res.json({ url: data.data.authorization_url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const webhook = async (req, res) => {
  console.log(req.body);
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const hash = req.headers["x-paystack-signature"];

  // Verify request signature
  const hmac = crypto.createHmac("sha512", secret);
  hmac.update(JSON.stringify(req.body));
  const digest = hmac.digest("hex");
  if (digest !== hash) {
    console.error("Invalid webhook signature");
    res.status(400).send("Invalid signature");
    return;
  }

  // Perform necessary actions based on the webhook event
  const event = req.body.event;
  switch (event) {
    case "charge.success":
      const { customer, channel, reference, amount } = req.body.data;
      const user = await User.findOne({ email: customer.email });
      if (!user) {
        return res.status(404).json({ message: "No user found" });
      }

      const bill = await Bill.findOne({
        _id: req.body.data.metadata.billId,
        individual: user._id,
      });
      if (!bill) {
        return res.status(404).json({ message: "No bill found" });
      }
      bill.status = "paid";
      bill.bill_amount = amount;
      bill.transaction_ref = reference;
      bill.mode_of_payment = channel;
      if (bill.name === "annual membership certificate") {
        bill.validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      }

      bill.save();

      break;
    case "charge.failure":
      break;
  }

  res.status(200).send("OK");
};

const userEvents = async (req, res) => {
  let user;
  let event;
  try {
    user = await User.findById(req.userData.userId);
    event = await Event.find({ members: user.membership_type });
    res.json(event);
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Something went wrong, Please try again" });
  }
};

module.exports = {
  signup,
  verifyEmail,
  login,
  forgotPassword,
  resetPassword,
  editProfile,
  resendLink,
  getLoggedUser,
  getSingleFile,
  getUploadedFiles,
  download,
  getDownloadedFiles,
  userBills,
  getNewBill,
  getCert,
  preview,
  pay,
  webhook,
  userEvents,
};
