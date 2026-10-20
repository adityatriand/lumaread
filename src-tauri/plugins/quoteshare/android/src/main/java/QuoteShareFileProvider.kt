package com.lumaread.quoteshare

import androidx.core.content.FileProvider

// Own subclass: the app already declares androidx FileProvider, and a manifest allows one <provider> per class name
class QuoteShareFileProvider : FileProvider()
