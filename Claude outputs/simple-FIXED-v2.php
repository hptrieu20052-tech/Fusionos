<?php
/**
 * Simple product add to cart
 *
 * This template can be overridden by copying it to yourtheme/woocommerce/single-product/add-to-cart/simple.php.
 *
 * @see https://woocommerce.com/document/template-structure/
 * @package WooCommerce\Templates
 * @version 7.0.1
 *
 * FUSION fix 10/2026: type khong co mau -> an han nhan "Colors:" (server + JS)
 * va xoa attribute_color de order khong bi ghi mau ao "Color: Black".
 */

defined( 'ABSPATH' ) || exit;

global $product;

if ( ! $product || ! $product->is_type( 'simple' ) || ! $product->is_purchasable() ) {
    return;
}

echo wc_get_stock_html( $product ); // WPCS: XSS ok.

// Get product variants directly from data/products.json (filtered by product's assigned styles if configured)
$product_id_val = is_a( $product, 'WC_Product' ) ? $product->get_id() : get_the_ID();
$product_attributes = function_exists( 'wcp_get_product_variants_data' ) ? wcp_get_product_variants_data( $product_id_val ) : array();
if ( empty( $product_attributes ) || ! is_array( $product_attributes ) ) {
    $products_json_path = plugin_dir_path( dirname( dirname( dirname( dirname( dirname( __FILE__ ) ) ) ) ) ) . 'data/products.json';
    if ( ! file_exists( $products_json_path ) ) {
        $products_json_path = WP_CONTENT_DIR . '/plugins/woo-custom-pro/data/products.json';
    }
    if ( file_exists( $products_json_path ) ) {
        $json_content = file_get_contents( $products_json_path );
        $product_attributes = json_decode( $json_content, true );
        if ( ! is_array( $product_attributes ) ) {
            $product_attributes = array();
        }
    }
}

// Display setting: Show/hide color name below swatch
$show_color_names = function_exists( 'wcp_is_show_color_name' ) ? wcp_is_show_color_name() : ( get_option( 'wcp_show_color_name', 'yes' ) === 'yes' );

do_action( 'woocommerce_before_add_to_cart_form' ); ?>

<?php if ( ! empty( $product_attributes ) ) : ?>
<div class="form__customize">
    <h4 class="style__title">Style:</h4>
    <div class="list__styles">
        <?php foreach ( $product_attributes as $key => $style ) :
            $style_title = isset( $style['styles'] ) ? $style['styles'] : '';
            $style_img   = isset( $style['image'] ) ? $style['image'] : '';
            $style_colors = isset( $style['colors'] ) ? $style['colors'] : array();
            $style_sizes  = isset( $style['sizes'] ) ? $style['sizes'] : array();
            $style_designs = isset( $style['designs'] ) ? $style['designs'] : array();
        ?>
            <div class="style__item">
                <div class="style__item__image"
                     data-style="<?php echo esc_attr( $style_title ); ?>"
                     data-colors="<?php echo esc_attr( wp_json_encode( $style_colors ) ); ?>"
                     data-sizes="<?php echo esc_attr( wp_json_encode( $style_sizes ) ); ?>"
                     data-designs="<?php echo esc_attr( wp_json_encode( $style_designs ) ); ?>"
                     onclick="setStyle(this)">
                    <?php if ( empty( $style_img ) ) : ?>
                        <span><?php echo esc_html( $style_title ); ?></span>
                    <?php else : ?>
                        <img alt="<?php echo esc_attr( $style_title ); ?>" src="<?php echo esc_url( $style_img ); ?>" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';">
                        <span style="display:none;"><?php echo esc_html( $style_title ); ?></span>
                    <?php endif; ?>
                </div>
            </div>
        <?php endforeach; ?>
    </div>
    <h4 class="size__title">Size:</h4>
    <div class="list__sizes"></div>
    <?php
    // FUSION fix: khong style nao co mau -> an san nhan Colors tu server (type ornament/calendar/sach...)
    $wcp_any_colors = false;
    foreach ( $product_attributes as $wcp_it ) {
        if ( ! empty( $wcp_it['colors'] ) && is_array( $wcp_it['colors'] ) ) { $wcp_any_colors = true; break; }
    }
    $wcp_colors_hide = $wcp_any_colors ? '' : ' style="display:none;"';
    ?>
    <h4 class="color__title"<?php echo $wcp_colors_hide; ?>>Colors:</h4>
    <div class="list__colors"<?php echo $wcp_colors_hide; ?>></div>
</div>
<?php endif; ?>

<form class="variations_form cart" action="<?php echo esc_url( apply_filters( 'woocommerce_add_to_cart_form_action', $product->get_permalink() ) ); ?>" method="post" enctype='multipart/form-data' data-product_id="<?php echo absint( $product->get_id() ); ?>">
    <input type="hidden" name="attribute_style" value="Unisex T-shirt"/>
    <input type="hidden" name="attribute_size" value="S"/>
    <input type="hidden" name="attribute_color" value="Black"/>
    <input type="hidden" name="custom_price" value="<?php echo esc_attr( $product->get_price() ? $product->get_price() : '20' ); ?>"/>
    <input type="hidden" name="add-to-cart" value="<?php echo absint( $product->get_id() ); ?>"/>
    <input type="hidden" name="product_id" value="<?php echo absint( $product->get_id() ); ?>"/>

    <div class="woocommerce-variation-add-to-cart variations_button">
        <?php do_action( 'woocommerce_before_add_to_cart_button' ); ?>

        <?php
        woocommerce_quantity_input(
            array(
                'min_value'   => apply_filters( 'woocommerce_quantity_input_min', $product->get_min_purchase_quantity(), $product ),
                'max_value'   => apply_filters( 'woocommerce_quantity_input_max', $product->get_max_purchase_quantity(), $product ),
                'input_value' => isset( $_POST['quantity'] ) ? wc_stock_amount( wp_unslash( $_POST['quantity'] ) ) : $product->get_min_purchase_quantity(),
            )
        );

        do_action( 'woocommerce_after_add_to_cart_quantity' );
        ?>
    </div>

    <div class="add__to__cart" style="margin-top: 15px; margin-bottom: 15px;">
        <button type="submit" class="single_add_to_cart_button button alt button__cart" style="width: 100%; font-size: 16pt; padding: 12px; cursor: pointer; border-radius: 5px;">Buy It Now</button>
    </div>

    <div class="flag" style="display: flex; border: 1px dashed #d5d5d5; padding: 8px; margin-bottom: 10px; align-items: center;">
        <div class="flag-img" style="padding-right: 10px;">
            <span class="inline-svg">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" height="40" width="40" aria-hidden="true" focusable="false">
                    <g class="cart-frame">
                        <path class="cart-fill" fill="#FFAC5D" d="M19,33h20l5-18H15"></path>
                        <path fill="#333333" d="M43,14H14.7L13,5.8C12.8,5.3,12.5,5,12,5H5C4.3,5,4,5.4,4,6s0.4,1,1,1h6.2l1.8,8c0,0.1,0,0.3,0.1,0.4 l4,17.8c0.1,0.5,0.5,0.8,1,0.8h20c0.6,0,1-0.4,1-1s-0.4-1-1-1H18.8l-3.6-16H43c0.6,0,1-0.4,1-1S43.6,14,43,14z"></path>
                        <path fill="#333333" d="M22.5,36c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5s3.5-1.6,3.5-3.5S24.3,36,22.5,36z M22.5,41 c-0.8,0-1.5-0.7-1.5-1.5s0.7-1.5,1.5-1.5s1.5,0.7,1.5,1.5S23.2,41,22.5,41z"></path>
                        <path fill="#333333" d="M34.5,36c-1.9,0-3.5,1.6-3.5,3.5s1.6,3.5,3.5,3.5s3.5-1.6,3.5-3.5S36.3,36,34.5,36z M34.5,41 c-0.8,0-1.5-0.7-1.5-1.5s0.7-1.5,1.5-1.5s1.5,0.7,1.5,1.5S35.3,41,34.5,41z"></path>
                    </g>
                    <line class="line-right" fill="none" stroke="#333333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" x1="37" y1="8" x2="33.8" y2="11.1"></line>
                    <line class="line-center" fill="none" stroke="#333333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" x1="29" y1="6" x2="29" y2="10"></line>
                    <line class="line-left" fill="none" stroke="#333333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" x1="21" y1="8" x2="24" y2="11.1"></line>
                </svg>
            </span>
        </div>
        <div class="flag-body2" style="font-size: 13px; line-height: 1.4;">
            <strong>Other people want this.</strong> Over <span id="peopleol">408</span> people have this in their cart right now.<br/>Fast Shipping Worldwide for all orders.
        </div>
    </div>

    <?php
    $checkout_badge_url = function_exists( 'wcp_get_checkout_badge_image_url' ) ? wcp_get_checkout_badge_image_url() : get_option( 'wcp_checkout_image_url', '/wp-content/uploads/2022/04/Guaranteed-Safe-Checkout.png' );
    if ( ! empty( $checkout_badge_url ) ) : ?>
        <img style="padding-top: 10px; width: 100%;" alt="Guaranteed Safe Checkout" src="<?php echo esc_url( $checkout_badge_url ); ?>" class="entered lazyloaded checkout-badge-img">
    <?php endif; ?>

    <?php do_action( 'woocommerce_after_add_to_cart_button' ); ?>
</form>

<style>
.shop-container .list__styles,
.list__colors,
.list__sizes {
    display: flex;
    flex-wrap: wrap;
    flex: 1 1 auto;
    padding: 5px 0px;
}

.shop-container .list__styles .style__item,
.shop-container .list__styles .size__item {
    padding: 2px;
    position: relative;
}

.shop-container .list__styles .style__item .style__item__image {
    border: 2px solid #ddd;
    padding: 5px 8px;
    border-radius: 5px;
    margin-bottom: 2px;
    overflow: hidden;
    transition: all ease 0.3s;
    cursor: pointer;
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.shop-container .list__styles .style__item .style__item__image:hover,
.shop-container .list__styles .style__item .style__item__image.active {
    border: 2px solid #3cad4a;
    transition: all ease 0.3s;
}

.shop-container .list__styles .style__item .style__item__image:hover img,
.shop-container .list__styles .style__item .style__item__image.active img {
    transform: scale3d(1.1, 1.1, 1);
    transition: all ease 0.3s;
}

.shop-container .list__styles .style__item .style__item__image > img {
    width: 40px;
    height: 50px;
    border-radius: 5px;
    object-fit: cover;
}

.size__item {
    padding: 8px 12px;
    border: 2px solid #ddd;
    min-width: 45px;
    height: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    border-radius: 5px;
    margin-right: 5px;
    margin-bottom: 5px;
    transition: all ease 0.3s;
    cursor: pointer;
    font-weight: 600;
}

.size__item:hover,
.size__item.active {
    background-color: #3cad4a;
    border: 2px solid #3cad4a;
    color: #fff;
    transition: all ease 0.3s;
}

.list__colors {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px 6px;
    padding: 5px 0px;
}

.colors__item {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    margin-right: 4px;
    margin-bottom: 8px;
    cursor: pointer;
    text-align: center;
    user-select: none;
    -webkit-user-select: none;
    vertical-align: top;
}

.colors__item .colors__item__swatch {
    width: 38px;
    height: 38px;
    border-radius: 6px;
    padding: 2px;
    border: 2px solid #ddd;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    transition: all ease 0.2s;
    background-clip: padding-box;
    overflow: hidden;
}

.colors__item:hover .colors__item__swatch,
.colors__item.active .colors__item__swatch {
    border: 2px solid #3cad4a;
    box-shadow: 0 0 4px rgba(60, 173, 74, 0.6);
    transform: scale(1.05);
}

.colors__item .colors__item__name {
    margin-top: 4px;
    font-size: 12px;
    font-weight: 500;
    color: #222;
    max-width: 58px;
    word-break: break-word;
    line-height: 1.2;
    text-align: center;
    transition: color ease 0.2s, font-weight ease 0.2s;
}

.colors__item:hover .colors__item__name,
.colors__item.active .colors__item__name {
    color: #000;
    font-weight: 700;
}

.button__cart {
    background-color: #3cad4a !important;
    color: #fff !important;
    border: none;
    font-weight: bold;
}

.button__cart:hover {
    background-color: #33983f !important;
}

.form__customize h4 {
    margin-bottom: 4px;
    margin-top: 10px;
    font-size: 15px;
    font-weight: 600;
}

.related-products-container {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 20px;
    margin-top: 30px;
}

@media screen and (max-width: 767px) {
    .related-products-container {
        grid-template-columns: repeat(2, 1fr);
    }
}

.related-product {
    text-align: center;
    padding: 5px;
}

.related-product img {
    border-radius: 5px;
    width: 100%;
    height: auto;
}
</style>

<script>
jQuery(document).ready(function($) {
    // Load Related Products
    var productId = <?php echo absint( $product->get_id() ); ?>;
    var apiUrl = '/wp-json/custom/v1/related-products/' + productId;

    $.ajax({
        url: apiUrl,
        method: 'GET',
        success: function(response) {
            if (Array.isArray(response) && response.length > 0) {
                renderRelatedProducts(response);
            }
        },
        error: function(xhr, status, error) {
            console.error('Related products load error:', error);
        }
    });

    function renderRelatedProducts(products) {
        var $relatedProductsContainer = $('#related-products-container');
        if (!$relatedProductsContainer.length) return;
        $relatedProductsContainer.empty();

        $.each(products, function(index, item) {
            var productHtml = '<div class="related-product">' +
                                '<a href="' + item.permalink + '">' +
                                    '<img src="' + item.image + '" alt="' + item.title + '">' +
                                    '<h4 style="margin-top:8px;font-size:14px;">' + item.title + '</h4>' +
                                '</a>' +
                            '</div>';
            $relatedProductsContainer.append(productHtml);
        });
    }

    // Initialize variations selector with first style
    var $firstStyle = $('.style__item__image').first();
    if ($firstStyle.length > 0) {
        setStyle($firstStyle[0]);
    }

    $('.minus.button, .plus.button').on('click', function() {
        setTimeout(function() {
            var qtyVal = $('.input-text.qty').val();
            $('input[name="quantity"]').val(qtyVal);
        }, 50);
    });
});

function setStyle(element) {
    var $ = jQuery;
    if (!element) return;
    var $el = $(element);
    if (!$el.length) return;

    $('.style__item__image').removeClass('active');
    $el.addClass('active');

    var style = $el.data('style') || '';
    var sizes = $el.data('sizes') || [];
    var colors = $el.data('colors') || [];

    if (typeof sizes === 'string') {
        try { sizes = JSON.parse(sizes); } catch(e) { sizes = []; }
    }
    if (typeof colors === 'string') {
        try { colors = JSON.parse(colors); } catch(e) { colors = []; }
    }

    var $listSizes = $('.list__sizes');
    var $listColors = $('.list__colors');

    if ($listSizes.length) $listSizes.empty();
    if ($listColors.length) $listColors.empty();

    $('.style__title').text('Style: ' + style);

    if (Array.isArray(sizes) && sizes.length > 0) {
        for (var i = 0; i < sizes.length; i++) {
            // FUSION fix 10/2026: ten size co dau " (vd 11" x 8.5" / Matte) lam attribute HTML bi cat
            // tai dau " dau tien -> don chi ghi "Size: 11". Dung DOM/.attr() thay vi noi chuoi HTML.
            // Gia: cat o dau "-" CUOI va chi khi phan sau la so (ten chua "-" khong bi vo).
            var sRaw = String(sizes[i]);
            var sCut = sRaw.lastIndexOf('-');
            var sTail = sCut > 0 ? sRaw.slice(sCut + 1) : '';
            var sHasPrice = sCut > 0 && sTail !== '' && !isNaN(parseFloat(sTail)) && isFinite(sTail);
            var sName = sHasPrice ? sRaw.slice(0, sCut) : sRaw;
            var sPrice = sHasPrice ? sTail : '';
            var $sItem = $('<div class="size__item" onclick="setSize(this)"><span></span></div>');
            $sItem.attr('data-size', sName).attr('data-price', sPrice);
            $sItem.find('span').text(sName);
            $listSizes.append($sItem);
        }
    }

    var showColorName = <?php echo json_encode( $show_color_names ); ?>;

    // FUSION fix: style khong co mau -> an nhan "Colors:" + xoa attribute_color (tranh order ghi mau ao "Black")
    if (!Array.isArray(colors) || colors.length === 0) {
        $('.color__title').hide();
        $listColors.hide();
        $('input[name="attribute_color"]').val('');
    } else {
        $('.color__title').show();
        $listColors.show();
    }

    if (Array.isArray(colors) && colors.length > 0) {
        for (var j = 0; j < colors.length; j++) {
            // FUSION fix 10/2026: dung DOM/.attr()/.text() de ten mau co ky tu dac biet (", <, &...)
            // khong pha vo attribute/HTML nhu loi Size o tren.
            var cParts = String(colors[j]).split('|');
            var cName = cParts[0];
            var $cItem = $('<div class="colors__item" onclick="setColor(this)"></div>').attr('data-color', cName);
            var $swatch = $('<div class="colors__item__swatch"></div>');

            if (cParts.length === 1) {
                $swatch.attr('style', 'padding:4px 8px; width:auto; min-width:38px;').append($('<span></span>').text(cName));
            } else if (cParts.length === 3 && cParts[2]) {
                $swatch.attr('style', 'padding:0px;').append(
                    $('<img style="width:100%;height:100%;border-radius:4px;object-fit:cover;"/>').attr('src', cParts[2])
                );
            } else {
                var rawHex = cParts[1] || '000000';
                var cHex = rawHex.startsWith('#') ? rawHex : ('#' + rawHex);
                $swatch.css('background', cHex);
            }
            $cItem.append($swatch);
            if (showColorName) $cItem.append($('<span class="colors__item__name"></span>').text(cName));
            $listColors.append($cItem);
        }
    }

    var $firstSize = $('.size__item').first();
    if ($firstSize.length > 0) {
        setSize($firstSize[0]);
    }

    var $firstColor = $('.colors__item').first();
    if ($firstColor.length > 0) {
        setColor($firstColor[0]);
    }

    $('input[name="attribute_style"]').val(style);
}

function setSize(element) {
    var $ = jQuery;
    if (!element) return;
    var $el = $(element);
    if (!$el.length) return;

    $('.size__item').removeClass('active');
    $el.addClass('active');

    var size = $el.data('size');
    var price = $el.data('price');

    $('.size__title').text('Size: ' + size);

    if (price) {
        var numPrice = parseFloat(price);
        var discountPercent = <?php echo floatval( function_exists( 'wcp_get_discount_percentage' ) ? wcp_get_discount_percentage() : 20 ); ?>;
        var regularPrice = (numPrice * (1 + (discountPercent / 100))).toFixed(2);
        var formattedSalePrice = numPrice.toFixed(2);

        var $priceElem = $('.price.product-page-price, .price-wrapper .price, .single-product .price');
        if ($priceElem.length) {
            $priceElem.first().html(
                '<del aria-hidden="true" class="wcp-del-price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>' + regularPrice + '</bdi></span></del> ' +
                '<ins class="wcp-ins-price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">$</span>' + formattedSalePrice + '</bdi></span></ins>'
            );
        }
        $('input[name="custom_price"]').val(price);
    }

    $('input[name="attribute_size"]').val(size);
}

function setColor(element) {
    var $ = jQuery;
    if (!element) return;
    var $el = $(element);
    if (!$el.length) return;

    $('.colors__item').removeClass('active');
    $el.addClass('active');

    var color = $el.data('color');
    $('.color__title').text('Colors: ' + color);
    $('input[name="attribute_color"]').val(color);
}

function createSlug(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
</script>

<?php
do_action( 'woocommerce_after_add_to_cart_form' );
